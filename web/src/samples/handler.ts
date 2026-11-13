/**
 * `POST /api/sample` `{ id }`: a recorded sample, re-checked with P1 to P8 so
 * the checks shown are current. P9 and P10 are the recorded judge verdicts
 * (`judgeRecorded: true`). There is no model call, so this route spends no
 * model quota and has no model rate limit.
 */
import { z } from "zod";
import { CheckerUnavailable } from "@/src/checker-client/errors";
import type { ActionSynonym, CheckResult, KeyFact, Line, LineFactSpan, Sentence } from "@/src/checker-client/schemas";
import { mergeJudgeChecks } from "@/src/check/merge";
import { errorName, errorResponse, NO_STORE, readJson } from "@/src/http/response";
import { NOTICE, completeChecks, statusOf } from "@/src/pipeline/decide";
import type { ConversionResult, Rule, Status } from "@/src/pipeline/types";
import type { SampleCatalog } from "./catalog";
import { MAX_SAMPLE_BODY_BYTES, SAMPLE_ERRORS, type SampleErrorCode } from "./errors";
import { type SampleInfo, sampleIdSchema, sampleInfo } from "./sample";

/** Checker calls only. There is deliberately no model in these deps. */
export interface SampleRouteChecker {
  health(): Promise<{ status: "ok" | "starting" }>;
  analyse(original: string): Promise<{ sentences: Sentence[]; key_facts: KeyFact[] }>;
  check(request: { original: string; key_facts: KeyFact[]; lines: Line[] }): Promise<CheckResult[]>;
  lineFacts(request: { key_facts: KeyFact[]; lines: Line[] }): Promise<LineFactSpan[]>;
  actionSynonyms(): Promise<ActionSynonym[]>;
}

export interface SampleHandlerDeps {
  getChecker: () => SampleRouteChecker;
  catalog: SampleCatalog;
  logger?: (event: SampleLogEvent) => void;
  now?: () => number;
}

/** The 200 body. */
export interface SampleResponse {
  result: ConversionResult;
  sample: SampleInfo;
  /** P9 and P10 are from the recording, not judged now. Always true. */
  judgeRecorded: true;
}

export interface SampleLogEvent {
  msg: "sample_request";
  outcome: "ok" | SampleErrorCode;
  status: number;
  sample?: string;
  result?: Status;
  failedRules?: Rule[];
  errorName?: string;
  ms: number;
}

export const sampleBodySchema = z.object({ id: sampleIdSchema });


const defaultLogger = (event: SampleLogEvent) => console.info(JSON.stringify(event));

/** The recorded result with P1 to P8 checked again now and P9 and P10 carried over. */
export async function recheckSample(
  recorded: ConversionResult,
  checker: SampleRouteChecker,
): Promise<{ ok: true; result: ConversionResult } | { ok: false; error: "sample_outdated" }> {
  const original = recorded.original.text;
  const { sentences, key_facts: keyFacts } = await checker.analyse(original);
  const sentenceIds = new Set(sentences.map((s) => s.id));
  const lines: Line[] = recorded.lines.map((l) => ({
    id: l.id,
    text: l.text,
    source_sentence_id: l.source_sentence_id,
    symbol_id: l.symbol_id,
  }));
  // The checker splits sentences differently from when the sample was recorded.
  if (lines.some((l) => !sentenceIds.has(l.source_sentence_id))) return { ok: false, error: "sample_outdated" };

  const ruleChecks = await checker.check({ original, key_facts: keyFacts, lines }); // P1-P8
  const judgeChecks = mergeJudgeChecks(recorded.checks, [], new Set(lines.map((l) => l.id)));
  const checks = completeChecks([...ruleChecks.filter((c) => c.rule !== "P9" && c.rule !== "P10"), ...judgeChecks]);
  const status = statusOf(checks);
  const blocked = status === "blocked";
  const outLines = blocked ? [] : lines;
  const [lineFacts, actionSynonyms] = await Promise.all([
    blocked ? Promise.resolve([]) : checker.lineFacts({ key_facts: keyFacts, lines: outLines }),
    checker.actionSynonyms(),
  ]);
  return {
    ok: true,
    result: {
      status,
      original: { text: original, sentences },
      keyFacts,
      lines: outLines,
      checks,
      attempts: recorded.attempts,
      notice: NOTICE,
      judgeAvailable: recorded.judgeAvailable,
      models: recorded.models.map((m) => ({ ...m })),
      actionSynonyms,
      lineFacts,
    },
  };
}

export async function handleSample(request: Request, deps: SampleHandlerDeps): Promise<Response> {
  const log = deps.logger ?? defaultLogger;
  const now = deps.now ?? (() => performance.now());
  const started = now();
  const ms = () => Math.round(now() - started);

  const reject = (error: SampleErrorCode, extra: Partial<SampleLogEvent> = {}, err?: unknown) => {
    const { status, message } = SAMPLE_ERRORS[error];
    log({
      msg: "sample_request",
      outcome: error,
      status,
      ...extra,
      ...(error === "internal" ? errorName(err) : {}),
      ms: ms(),
    });
    return errorResponse({ error, status, message });
  };

  const read = await readJson(request, MAX_SAMPLE_BODY_BYTES);
  if (!read.ok) return reject("invalid_request");
  const parsed = sampleBodySchema.safeParse(read.json);
  if (!parsed.success) return reject("invalid_request");
  const id = parsed.data.id;

  const sample = deps.catalog.find(id);
  if (!sample) return reject("not_found");

  try {
    const checker = deps.getChecker();
    const health = await checker.health();
    if (health.status !== "ok") return reject("checker_unavailable", { sample: id });
    const rechecked = await recheckSample(sample.result, checker);
    if (!rechecked.ok) return reject(rechecked.error, { sample: id });
    const { result } = rechecked;
    log({
      msg: "sample_request",
      outcome: "ok",
      status: 200,
      sample: id,
      result: result.status,
      failedRules: result.checks.filter((c) => !c.passed).map((c) => c.rule),
      ms: ms(),
    });
    const body: SampleResponse = { result, sample: sampleInfo(sample), judgeRecorded: true };
    return Response.json(body, { status: 200, headers: NO_STORE });
  } catch (err) {
    return reject(err instanceof CheckerUnavailable ? "checker_unavailable" : "internal", { sample: id }, err);
  }
}
