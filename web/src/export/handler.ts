/**
 * `POST /api/export`: renders the result on screen as an A4 PDF (R8.1 to R8.3).
 *
 * The client's status is never trusted (R9.5). A blocked or unjudged result
 * is refused, then the server analyses the Original again and re-runs P1 to
 * P8 before rendering. The result reaches Chromium as 1 static HTML string
 * with pictures inlined as `data:` URIs, so letter text is never in a URL,
 * file or cache (R7.4).
 */
import { z } from "zod";
import { MAX_CHECK_LINES, MAX_EDIT_LINE_CHARS, MAX_ID_CHARS } from "@/src/check/errors";
import { judgeAvailableAfterMerge, mergeJudgeChecks } from "@/src/check/merge";
import { CheckerUnavailable } from "@/src/checker-client/errors";
import { type CheckResult, type KeyFact, type Line, type Sentence, checkResultSchema } from "@/src/checker-client/schemas";
import { letterLengthProblem } from "@/src/convert/word-count";
import { type RouteFailure, NO_STORE, errorName, errorResponse, rateLimitFailure, readJson } from "@/src/http/response";
import { NOTICE, completeChecks } from "@/src/pipeline/decide";
import type { Rule } from "@/src/pipeline/types";
import { type RateLimiter, rateLimit as defaultRateLimit } from "@/src/rate-limit";
import { conversionResultSchema } from "@/src/ui/convert-events";
import { ChromiumUnavailable, type PdfRenderer, pdfPageCount } from "./chromium";
import { EXPORT_ERRORS, EXPORT_FILENAME, type ExportErrorCode, MAX_EXPORT_BODY_BYTES } from "./errors";
import { type PictureLoader, loadPictures } from "./pictures";
import { printDocument } from "./print-document";
import { renderPrintHtml } from "./print-html";
import { type ExportQueue, QueueFullError, QueueTimeoutError } from "./queue";

export interface ExportRouteChecker {
  /** Throws `CheckerUnavailable` when the service is down or starting. */
  health(): Promise<{ status: "ok" | "starting" }>;
  analyse(original: string): Promise<{ sentences: Sentence[]; key_facts: KeyFact[] }>;
  check(request: { original: string; key_facts: KeyFact[]; lines: Line[] }): Promise<CheckResult[]>;
}

export interface ExportHandlerDeps {
  getChecker: () => ExportRouteChecker;
  /** Built only once the result has passed the server's P1 check. */
  getRenderer: () => PdfRenderer;
  queue: ExportQueue;
  loadPicture: PictureLoader;
  rateLimit?: RateLimiter;
  logger?: (event: ExportLogEvent) => void;
  now?: () => number;
}

/** Counts and rule results only. No letter content, no client address. */
export interface ExportLogEvent {
  msg: "export_request";
  outcome: "ok" | ExportErrorCode;
  status: number;
  lines?: number;
  pictures?: number;
  failedRules?: Rule[];
  bytes?: number;
  pages?: number;
  errorName?: string;
  ms: number;
}

const idSchema = z.string().min(1).max(MAX_ID_CHARS).regex(/^\S+$/u);

const exportLineSchema = z.object({
  id: idSchema,
  text: z.string().min(1).max(MAX_EDIT_LINE_CHARS),
  source_sentence_id: idSchema,
  symbol_id: idSchema.nullable(),
});

export const exportBodySchema = conversionResultSchema
  .extend({
    lines: z.array(exportLineSchema).max(MAX_CHECK_LINES),
    checks: z.array(checkResultSchema).max(20),
  })
  .superRefine((body, ctx) => {
    const ids = new Set<string>();
    for (const l of body.lines) {
      if (ids.has(l.id)) ctx.addIssue({ code: "custom", path: ["lines"], message: "line ID given twice" });
      ids.add(l.id);
    }
  });

export type ExportBody = z.infer<typeof exportBodySchema>;


const defaultLogger = (event: ExportLogEvent) => console.info(JSON.stringify(event));

type Failure = RouteFailure<ExportErrorCode>;

function failure(error: keyof typeof EXPORT_ERRORS): Failure {
  return { error, ...EXPORT_ERRORS[error] };
}

/** The error's own message is never used: it could quote letter content. */
function classifyError(err: unknown): Failure {
  if (err instanceof CheckerUnavailable) return failure("checker_unavailable");
  if (err instanceof QueueFullError || err instanceof QueueTimeoutError) return { ...failure("busy"), retryAfterSeconds: 30 };
  if (err instanceof ChromiumUnavailable) return failure("export_unavailable");
  return failure("internal");
}

type Parsed = { ok: true; body: ExportBody } | { ok: false; failure: Failure };

async function parseRequest(request: Request): Promise<Parsed> {
  const read = await readJson(request, MAX_EXPORT_BODY_BYTES);
  if (!read.ok) return { ok: false, failure: failure(read.reason === "too_large" ? "too_large" : "invalid_request") };
  // zod issues are not passed on: some quote the received value.
  const parsed = exportBodySchema.safeParse(read.json);
  if (!parsed.success) return { ok: false, failure: failure("invalid_request") };
  if (letterLengthProblem(parsed.data.original.text) !== null) return { ok: false, failure: failure("invalid_request") };
  return { ok: true, body: parsed.data };
}

export async function handleExport(request: Request, deps: ExportHandlerDeps): Promise<Response> {
  const log = deps.logger ?? defaultLogger;
  const now = deps.now ?? (() => performance.now());
  const started = now();
  const ms = () => Math.round(now() - started);

  const reject = (f: Failure, extra: Partial<ExportLogEvent> = {}, err?: unknown) => {
    log({
      msg: "export_request",
      outcome: f.error,
      status: f.status,
      ...extra,
      ...(f.error === "internal" || f.error === "export_failed" ? errorName(err) : {}),
      ms: ms(),
    });
    return errorResponse(f);
  };

  const parsed = await parseRequest(request);
  if (!parsed.ok) return reject(parsed.failure);
  const body = parsed.body;
  const original = body.original.text;
  const lines: Line[] = body.lines.map((l) => ({
    id: l.id,
    text: l.text,
    source_sentence_id: l.source_sentence_id,
    symbol_id: l.symbol_id,
  }));
  const counts = { lines: lines.length };

  // R9.5: the client's own "blocked" is enough to refuse; it is never enough to allow.
  if (body.status === "blocked" || lines.length === 0) return reject(failure("blocked"), counts);
  // Safety: P10 (no advice) must have run. The client's flag and its P9 and P10 details must both say the judge
  // answered, and both rules must be present: a missing judge result is never turned into a pass.
  const clientJudge = body.checks.filter((c) => c.rule === "P9" || c.rule === "P10");
  const judgeRulesPresent = clientJudge.some((c) => c.rule === "P9") && clientJudge.some((c) => c.rule === "P10");
  if (!judgeRulesPresent || !judgeAvailableAfterMerge(clientJudge, body.judgeAvailable)) {
    return reject(failure("not_judged"), { ...counts, failedRules: ["P9", "P10"] });
  }

  let checker: ExportRouteChecker;
  try {
    checker = deps.getChecker();
    const health = await checker.health();
    if (health.status !== "ok") return reject(failure("checker_unavailable"), counts);
  } catch (err) {
    return reject(classifyError(err), counts, err);
  }

  const limit = await (deps.rateLimit ?? defaultRateLimit)(request, "export");
  if (!limit.allowed) {
    return reject(rateLimitFailure(limit), counts);
  }

  let checks: CheckResult[];
  let serverKeyFacts: KeyFact[];
  try {
    // Key facts from the Original, never from the client (R2.4).
    const { sentences, key_facts: keyFacts } = await checker.analyse(original);
    const sentenceIds = new Set(sentences.map((s) => s.id));
    if (lines.some((l) => !sentenceIds.has(l.source_sentence_id))) return reject(failure("invalid_request"), counts);
    const ruleChecks = await checker.check({ original, key_facts: keyFacts, lines }); // P1-P8
    const p1 = ruleChecks.find((c) => c.rule === "P1");
    if (p1 === undefined || !p1.passed) return reject(failure("blocked"), { ...counts, failedRules: ["P1"] });
    const judgeChecks = mergeJudgeChecks(body.checks, [], new Set(lines.map((l) => l.id)));
    checks = completeChecks([...ruleChecks.filter((c) => c.rule !== "P9" && c.rule !== "P10"), ...judgeChecks]);
    serverKeyFacts = keyFacts;
  } catch (err) {
    return reject(classifyError(err), counts, err);
  }
  const failedRules = checks.filter((c) => !c.passed).map((c) => c.rule);

  let pictureCount = 0;
  let pdf: Uint8Array;
  try {
    pdf = await deps.queue.run(async () => {
      const doc = printDocument({
        checks,
        lines,
        keyFacts: serverKeyFacts,
        judgeAvailable: body.judgeAvailable,
        notice: NOTICE,
      });
      const pictures = await loadPictures(
        doc.rows.map((r) => r.symbolId),
        deps.loadPicture,
      );
      pictureCount = pictures.size;
      return deps.getRenderer().render(renderPrintHtml(doc, pictures));
    });
  } catch (err) {
    const f = classifyError(err);
    // Anything else thrown while rendering is a failed export, not a server fault.
    return reject(f.error === "internal" ? failure("export_failed") : f, { ...counts, failedRules }, err);
  }

  log({
    msg: "export_request",
    outcome: "ok",
    status: 200,
    ...counts,
    pictures: pictureCount,
    failedRules,
    bytes: pdf.byteLength,
    pages: pdfPageCount(pdf),
    ms: ms(),
  });
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      ...NO_STORE,
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${EXPORT_FILENAME}"`,
      "content-length": String(pdf.byteLength),
      "x-content-type-options": "nosniff",
    },
  });
}
