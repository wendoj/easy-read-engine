/**
 * `POST /api/check`: re-checks the lines after a user edit, without changing
 * them. P1 to P8 run on every line. The judge runs only on edited lines, and
 * P9 and P10 for the rest are carried over from `previousChecks`. Access,
 * body, checker health and rate limits are checked in that order, so nothing
 * spends quota unless it can finish.
 */
import { z } from "zod";
import { type AccessGate, requireAccess } from "@/src/access/key";
import { CheckerUnavailable } from "@/src/checker-client/errors";
import {
  type CheckResult,
  type KeyFact,
  type Line,
  type LineFactSpan,
  type Sentence,
  checkResultSchema,
} from "@/src/checker-client/schemas";
import { letterLengthProblem } from "@/src/convert/word-count";
import {
  type RouteFailure,
  NO_STORE,
  errorName,
  errorResponse,
  logJson,
  rateLimitFailure,
  readJson,
  stopwatch,
} from "@/src/http/response";
import type { JudgePair, JudgeResult } from "@/src/llm/judge";
import { statusOf } from "@/src/pipeline/decide";
import { judgeSourceText } from "@/src/pipeline/source-text";
import type { ModelUse, Rule, Status } from "@/src/pipeline/types";
import { type RateLimiter, rateLimit as defaultRateLimit } from "@/src/rate-limit";
import { CHECK_ERRORS, type CheckErrorCode, MAX_CHECK_BODY_BYTES, MAX_CHECK_LINES, MAX_EDIT_LINE_CHARS } from "./errors";
import { judgeAvailableAfterMerge, mergeJudgeChecks, withJudgeChecks } from "./merge";
import { type RouteChecker, copyLines, idSchema } from "./recheck";

export type CheckRouteChecker = RouteChecker;

export interface CheckModel {
  judge(pairs: JudgePair[]): Promise<JudgeResult>;
}

export interface CheckHandlerDeps {
  getChecker: () => CheckRouteChecker;
  /** Built only after the checker and limits allow the request. */
  getModel: () => CheckModel;
  /** Runs first, so a denied request costs no rate-limit units. */
  access?: AccessGate;
  rateLimit?: RateLimiter;
  logger?: (event: CheckLogEvent) => void;
  now?: () => number;
}

export interface CheckResponse {
  status: Status;
  checks: CheckResult[];
  /** The lines exactly as sent. Empty when blocked. */
  lines: Line[];
  /** Empty when blocked. */
  lineFacts: LineFactSpan[];
  /** From `analyse` on the Original, never from the client. */
  sentences: Sentence[];
  keyFacts: KeyFact[];
  /** False when any P9 or P10 result, new or carried over, is "judge unavailable". */
  judgeAvailable: boolean;
  models: ModelUse[];
}

/** Counts and rule results only. No letter content, no client address. */
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
    /** Must hold P9 and P10. */
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

type Failure = RouteFailure<CheckErrorCode>;

function failure(error: keyof typeof CHECK_ERRORS): Failure {
  return { error, ...CHECK_ERRORS[error] };
}

function classifyError(err: unknown): Failure {
  return err instanceof CheckerUnavailable ? failure("checker_unavailable") : failure("internal");
}

type Parsed = { ok: true; body: CheckBody } | { ok: false; failure: Failure };

async function parseRequest(request: Request): Promise<Parsed> {
  const read = await readJson(request, MAX_CHECK_BODY_BYTES);
  if (!read.ok) return { ok: false, failure: failure(read.reason === "too_large" ? "too_large" : "invalid_request") };
  // zod issues are not passed on: some quote the received value.
  const parsed = checkBodySchema.safeParse(read.json);
  if (!parsed.success) return { ok: false, failure: failure("invalid_request") };
  const body = parsed.data;
  // The Original already passed this limit at /api/convert.
  if (letterLengthProblem(body.original) !== null) return { ok: false, failure: failure("invalid_request") };
  if (body.lines.some((l) => l.text.trim() === "")) return { ok: false, failure: failure("empty_line") };
  if (body.lines.some((l) => l.text.length > MAX_EDIT_LINE_CHARS)) return { ok: false, failure: failure("too_long") };
  return { ok: true, body };
}

export async function handleCheck(request: Request, deps: CheckHandlerDeps): Promise<Response> {
  const log = deps.logger ?? logJson;
  const ms = stopwatch(deps.now);

  const reject = (f: Failure, extra: Partial<CheckLogEvent> = {}, err?: unknown) => {
    log({
      msg: "check_request",
      outcome: f.error,
      status: f.status,
      ...extra,
      ...(f.error === "internal" ? errorName(err) : {}),
      ms: ms(),
    });
    return errorResponse(f);
  };

  const denied = (deps.access ?? requireAccess)(request);
  if (denied) return reject(failure(denied.error));

  const parsed = await parseRequest(request);
  if (!parsed.ok) return reject(parsed.failure);
  const { original, editedLineIds, previousChecks } = parsed.body;
  const lines = copyLines(parsed.body.lines);
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
  if (!limit.allowed) return reject(rateLimitFailure(limit), counts);

  try {
    const { sentences, key_facts: keyFacts } = await checker.analyse(original);
    const sourceText = judgeSourceText(sentences);
    if (lines.some((l) => !sourceText.has(l.source_sentence_id))) {
      return reject(failure("invalid_request"), counts);
    }

    const ruleChecks = await checker.check({ original, key_facts: keyFacts, lines });

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
    const judged = await model.judge(pairs);

    const carried = new Set(lines.map((l) => l.id).filter((id) => !edited.has(id)));
    const judgeChecks = mergeJudgeChecks(previousChecks, judged.checks, carried);
    const checks = withJudgeChecks(ruleChecks, judgeChecks);
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
