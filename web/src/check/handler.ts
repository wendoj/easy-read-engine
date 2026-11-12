/**
 * `POST /api/check` as a plain `Request -> Response` function, so tests can
 * call it without Next.js (R9.1 to R9.4, design "Web route handlers").
 *
 * Called when the user saves an edit. Input:
 * `{ original, lines, editedLineIds, previousChecks }`.
 *
 * - The user's text is never changed. `lines` go to the checker and the judge
 *   as sent, and come back unchanged (or not at all when blocked).
 * - Key facts and sentences are taken again from the Original with the
 *   checker's `analyse`, never from the client, so P1 always compares the
 *   output with the Original (R2.1, R2.4). The response returns them.
 * - P1 to P8 run on every line (`check`). Pictures aren't attached again: the
 *   user's `symbol_id`s are kept and P8 validates them.
 * - The judge runs on the edited lines only, so 1 edit costs 1 model request.
 *   Unedited lines from the same source sentence go with them as context
 *   only (`contextOnly`), so the judge can see the parts they say.
 *   P9 and P10 verdicts for the other lines come from `previousChecks`, which
 *   the client sends from its current result, and are merged here so the
 *   server decides the status from all 10 rules (`merge.ts`).
 * - Status follows the same rules as `/api/convert` (`statusOf`). "blocked"
 *   whenever P1 fails, and a blocked response holds no lines (R2.5, R9.3).
 *   The client keeps the version before the edit for "Undo edit".
 *
 * Order, so nothing spends quota unless it can finish:
 * 1. Body size, JSON and zod: 400 or 413.
 * 2. Checker health: 503 if it's down, before any model call.
 * 3. Model config, then the shared rate limits (route "check", cost 1): 429 or 503.
 * 4. `analyse`, `check`, the judge on edited lines, then `lineFacts`.
 *
 * Nothing is stored. Logs hold counts, rule results, status and time. Never
 * the body, the Original, lines or key-fact values (R7.4).
 */
import { z } from "zod";
import { CheckerUnavailable } from "@/src/checker-client/errors";
import {
  type CheckResult,
  type KeyFact,
  type Line,
  type LineFactSpan,
  type Sentence,
  checkResultSchema,
} from "@/src/checker-client/schemas";
import { readBody } from "@/src/convert/handler";
import { letterLengthProblem } from "@/src/convert/word-count";
import type { JudgePair, JudgeResult } from "@/src/llm/judge";
import { completeChecks, statusOf } from "@/src/pipeline/decide";
import type { ModelUse, Rule, Status } from "@/src/pipeline/types";
import { type RateLimiter, rateLimit as defaultRateLimit } from "@/src/rate-limit";
import {
  CHECK_ERRORS,
  type CheckErrorCode,
  MAX_CHECK_BODY_BYTES,
  MAX_CHECK_LINES,
  MAX_EDIT_LINE_CHARS,
  MAX_ID_CHARS,
} from "./errors";
import { judgeAvailableAfterMerge, mergeJudgeChecks } from "./merge";

export interface CheckRouteChecker {
  /** Throws `CheckerUnavailable` when the service is down or starting. */
  health(): Promise<{ status: "ok" | "starting" }>;
  analyse(original: string): Promise<{ sentences: Sentence[]; key_facts: KeyFact[] }>;
  check(request: { original: string; key_facts: KeyFact[]; lines: Line[] }): Promise<CheckResult[]>;
  lineFacts(request: { key_facts: KeyFact[]; lines: Line[] }): Promise<LineFactSpan[]>;
}

/** The only model call this route makes. */
export interface CheckModel {
  judge(pairs: JudgePair[]): Promise<JudgeResult>;
}

export interface CheckHandlerDeps {
  getChecker: () => CheckRouteChecker;
  /** Built only after the checker and limits allow the request. */
  getModel: () => CheckModel;
  rateLimit?: RateLimiter;
  logger?: (event: CheckLogEvent) => void;
  now?: () => number;
}

/** The 200 body. */
export interface CheckResponse {
  status: Status;
  /** All 10 rules, P1 to P10 in order. */
  checks: CheckResult[];
  /** The lines exactly as sent. Empty when `status` is "blocked" (R2.5). */
  lines: Line[];
  /** Key-fact spans in `lines` (R5.3). Empty when blocked. */
  lineFacts: LineFactSpan[];
  /** From `analyse` on the Original. P1 used these key facts. */
  sentences: Sentence[];
  keyFacts: KeyFact[];
  /** False when any P9 or P10 result, new or carried over, is "judge unavailable". */
  judgeAvailable: boolean;
  /** Provider and model of the judge call, when it answered. */
  models: ModelUse[];
}

/** Log event. Counts and rule results only, no letter content, no client address. */
export interface CheckLogEvent {
  msg: "check_request";
  outcome: "ok" | CheckErrorCode;
  status: number;
  lines?: number;
  edited?: number;
  result?: Status;
  failedRules?: Rule[];
  judgeAvailable?: boolean;
  errorName?: string;
  ms: number;
}

const idSchema = z.string().min(1).max(MAX_ID_CHARS).regex(/^\S+$/u);

const lineSchema = z.object({
  id: idSchema,
  text: z.string(),
  source_sentence_id: idSchema,
  symbol_id: idSchema.nullable(),
});

export const checkBodySchema = z
  .object({
    original: z.string(),
    lines: z.array(lineSchema).min(1).max(MAX_CHECK_LINES),
    editedLineIds: z.array(idSchema).min(1).max(MAX_CHECK_LINES),
    /** The client's checks before this edit. Must hold P9 and P10. */
    previousChecks: z.array(checkResultSchema).max(20),
  })
  .superRefine((body, ctx) => {
    const ids = new Set<string>();
    for (const l of body.lines) {
      if (ids.has(l.id)) ctx.addIssue({ code: "custom", path: ["lines"], message: "line ID given twice" });
      ids.add(l.id);
    }
    if (new Set(body.editedLineIds).size !== body.editedLineIds.length) {
      ctx.addIssue({ code: "custom", path: ["editedLineIds"], message: "line ID given twice" });
    }
    if (body.editedLineIds.some((id) => !ids.has(id))) {
      ctx.addIssue({ code: "custom", path: ["editedLineIds"], message: "not a line ID" });
    }
    for (const rule of ["P9", "P10"] as const) {
      if (body.previousChecks.filter((c) => c.rule === rule).length !== 1) {
        ctx.addIssue({ code: "custom", path: ["previousChecks"], message: `needs exactly 1 ${rule} result` });
      }
    }
  });

export type CheckBody = z.infer<typeof checkBodySchema>;

const NO_STORE = { "cache-control": "no-store" };

const defaultLogger = (event: CheckLogEvent) => console.info(JSON.stringify(event));

interface Failure {
  error: CheckErrorCode;
  status: number;
  message: string;
  retryAfterSeconds?: number;
}

function failure(error: keyof typeof CHECK_ERRORS): Failure {
  return { error, ...CHECK_ERRORS[error] };
}

function errorResponse(f: Failure): Response {
  const headers: Record<string, string> = { ...NO_STORE };
  if (f.retryAfterSeconds !== undefined) headers["retry-after"] = String(f.retryAfterSeconds);
  return Response.json({ error: f.error, message: f.message }, { status: f.status, headers });
}

/** The error's own message is never used: it could quote the body. */
function classifyError(err: unknown): Failure {
  return err instanceof CheckerUnavailable ? failure("checker_unavailable") : failure("internal");
}

type Parsed = { ok: true; body: CheckBody } | { ok: false; failure: Failure };

async function parseRequest(request: Request): Promise<Parsed> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_CHECK_BODY_BYTES) return { ok: false, failure: failure("too_large") };
  const raw = await readBody(request, MAX_CHECK_BODY_BYTES);
  if (raw === null) return { ok: false, failure: failure("too_large") };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, failure: failure("invalid_request") };
  }
  // zod issues are not passed on: some quote the received value.
  const parsed = checkBodySchema.safeParse(json);
  if (!parsed.success) return { ok: false, failure: failure("invalid_request") };
  const body = parsed.data;
  // The Original passed this limit at /api/convert, so failing it now means the body isn't from this app.
  if (letterLengthProblem(body.original) !== null) return { ok: false, failure: failure("invalid_request") };
  if (body.lines.some((l) => l.text.trim() === "")) return { ok: false, failure: failure("empty_line") };
  if (body.lines.some((l) => l.text.length > MAX_EDIT_LINE_CHARS)) return { ok: false, failure: failure("too_long") };
  return { ok: true, body };
}

export async function handleCheck(request: Request, deps: CheckHandlerDeps): Promise<Response> {
  const log = deps.logger ?? defaultLogger;
  const now = deps.now ?? (() => performance.now());
  const started = now();
  const ms = () => Math.round(now() - started);

  const reject = (f: Failure, extra: Partial<CheckLogEvent> = {}, err?: unknown) => {
    log({
      msg: "check_request",
      outcome: f.error,
      status: f.status,
      ...extra,
      ...(f.error === "internal" && err instanceof Error ? { errorName: err.name } : {}),
      ms: ms(),
    });
    return errorResponse(f);
  };

  const parsed = await parseRequest(request);
  if (!parsed.ok) return reject(parsed.failure);
  const { original, editedLineIds, previousChecks } = parsed.body;
  // Fresh copies with exactly the 4 line fields, never altered below.
  const lines: Line[] = parsed.body.lines.map((l) => ({
    id: l.id,
    text: l.text,
    source_sentence_id: l.source_sentence_id,
    symbol_id: l.symbol_id,
  }));
  const counts = { lines: lines.length, edited: editedLineIds.length };

  let checker: CheckRouteChecker;
  try {
    checker = deps.getChecker();
    const health = await checker.health();
    if (health.status !== "ok") return reject(failure("checker_unavailable"), counts);
  } catch (err) {
    return reject(classifyError(err), counts, err);
  }

  let model: CheckModel;
  try {
    model = deps.getModel();
  } catch (err) {
    return reject(failure("internal"), counts, err);
  }

  const limit = await (deps.rateLimit ?? defaultRateLimit)(request, "check");
  if (!limit.allowed) {
    return reject(
      {
        error: limit.code,
        status: limit.status,
        message: limit.message,
        ...(limit.retryAfterSeconds !== undefined ? { retryAfterSeconds: limit.retryAfterSeconds } : {}),
      },
      counts,
    );
  }

  try {
    // Key facts and sentences from the Original, never from the client (R2.4).
    const { sentences, key_facts: keyFacts } = await checker.analyse(original);
    const sourceText = new Map(sentences.map((s) => [s.id, s.text]));
    if (lines.some((l) => !sourceText.has(l.source_sentence_id))) {
      return reject(failure("invalid_request"), counts);
    }

    const ruleChecks = await checker.check({ original, key_facts: keyFacts, lines }); // P1-P8, all lines

    const edited = new Set(editedLineIds);
    // Unedited lines from an edited line's sentence go along as context only,
    // so the judge sees every part of the sentence but judges only the edits.
    const editedSentences = new Set(lines.filter((l) => edited.has(l.id)).map((l) => l.source_sentence_id));
    const pairs: JudgePair[] = lines
      .filter((l) => edited.has(l.id) || editedSentences.has(l.source_sentence_id))
      .map((l) => ({
        lineId: l.id,
        sourceSentenceId: l.source_sentence_id,
        source: sourceText.get(l.source_sentence_id) ?? "",
        line: l.text,
        ...(edited.has(l.id) ? {} : { contextOnly: true }),
      }));
    const judged = await model.judge(pairs); // P9-P10, edited lines only

    const carried = new Set(lines.map((l) => l.id).filter((id) => !edited.has(id)));
    const judgeChecks = mergeJudgeChecks(previousChecks, judged.checks, carried);
    const checks = completeChecks([...ruleChecks.filter((c) => c.rule !== "P9" && c.rule !== "P10"), ...judgeChecks]);
    const status = statusOf(checks);
    const blocked = status === "blocked";
    const judgeAvailable = judgeAvailableAfterMerge(judgeChecks, judged.available);
    const outLines = blocked ? [] : lines.map((l) => ({ ...l }));
    const lineFacts = blocked ? [] : await checker.lineFacts({ key_facts: keyFacts, lines: outLines });

    const response: CheckResponse = {
      status,
      checks,
      lines: outLines,
      lineFacts,
      sentences,
      keyFacts,
      judgeAvailable,
      models: (
        judged.answers ??
        (judged.provider !== undefined && judged.model !== undefined
          ? [{ provider: judged.provider, model: judged.model }]
          : [])
      ).map((a) => ({ task: "judge" as const, attempt: 1, provider: a.provider, model: a.model })),
    };
    log({
      msg: "check_request",
      outcome: "ok",
      status: 200,
      ...counts,
      result: status,
      failedRules: checks.filter((c) => !c.passed).map((c) => c.rule),
      judgeAvailable,
      ms: ms(),
    });
    return Response.json(response, { status: 200, headers: NO_STORE });
  } catch (err) {
    return reject(classifyError(err), counts, err);
  }
}
