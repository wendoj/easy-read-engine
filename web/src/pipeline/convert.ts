/**
 * The convert, check and regenerate loop (design "Pipeline orchestrator").
 *
 * - Key facts come from the Original before the rewrite, so P1 compares with
 *   the source (R2.1, R2.4).
 * - Every try runs P1 to P8 on the checker and P9 and P10 in one judge call
 *   (R3.1). Only failing lines are regenerated, up to 3 tries in total (R3.3).
 * - `CheckerUnavailable` from `analyse`, `symbols` or `check` is not caught:
 *   the route returns 503, and unchecked output is never returned.
 * - A model error from the first rewrite (`ModelOutputError`,
 *   `ProviderChainError`) is not caught either: there is no checked result yet.
 *
 * Which try is the result: the last one, unless it fails P1 and an earlier
 * try passed P1. Then the latest try that passed P1 is the result instead.
 * Regenerating other lines can break a key fact that an earlier try kept,
 * and blocking would hide a checked output that kept every key fact (R3.5
 * blocks only when P1 "still fails"). `attempts` still counts every try.
 *
 * When a later step fails after a try was checked, that checked try is the
 * result, decided by `decide()` exactly as if it were the last try (so a
 * failing rule is still flagged, and P1 still blocks):
 * - Regenerate throws `ModelOutputError` or `ProviderChainError`. Other errors
 *   still propagate.
 * - `lineFacts` throws, including `CheckerUnavailable`. The rules already ran
 *   on these lines, so the result is checked; it is returned with
 *   `lineFacts: []`, which only means no key-fact highlighting in the lines.
 * Both are logged by error name only.
 *
 * Judge outage: `judge()` fails P9 and P10 on every line with "judge
 * unavailable" when the judge gives no valid answer. That says nothing about
 * the lines, so it doesn't send lines to regenerate. P9 and P10 stay failed
 * and are flagged (never passed), and `judgeAvailable` is false in the result,
 * which also disables export. If other rules failed, the next try calls the
 * judge again anyway. If no other rule failed, the loop makes one more try
 * with the same lines and no regenerate, to give the judge a second chance,
 * once per conversion and only while tries are left. A second outage ends
 * the loop there instead of spending more requests.
 */
import type { CheckResult, Line } from "@/src/checker-client/schemas";
import {
  type JudgePair,
  type LlmCallOptions,
  type ModelClient,
  ModelOutputError,
  ProviderChainError,
  collectFailures,
  judge,
  regenerate,
  rewrite,
} from "@/src/llm";
import { MAX_ATTEMPTS, completeChecks, decide, failingLineIds, missingFacts, regenerationChecks } from "./decide";
import { LineIds, type WorkingLine, applyRegeneration, fromDrafts, toLines } from "./lines";
import { attachSymbols } from "./symbols";
import type {
  ConversionResult,
  ModelUse,
  PipelineDeps,
  PipelineLogger,
  PipelineModel,
  PipelineStage,
} from "./types";

const defaultLogger: PipelineLogger = (event) => {
  console.info(JSON.stringify(event));
};

/** The real model calls on one model client. */
export function modelFromClient(client: ModelClient, options: LlmCallOptions = {}): PipelineModel {
  return {
    rewrite: (input) => rewrite(client, input, options),
    regenerate: (input) => regenerate(client, input, options),
    judge: (pairs) => judge(client, pairs, options),
  };
}

function judgePairs(lines: readonly WorkingLine[], sourceText: ReadonlyMap<string, string>): JudgePair[] {
  return lines.map((l) => ({ lineId: l.id, source: sourceText.get(l.source_sentence_id) ?? "", line: l.text }));
}

const errorName = (err: unknown) => (err instanceof Error ? err.name : "unknown");

/** One checked try: the lines and the rule results for them. */
interface CheckedTry {
  lines: Line[];
  checks: CheckResult[];
  attempt: number;
  judgeAvailable: boolean;
}

const passesP1 = (t: CheckedTry) => t.checks.find((c) => c.rule === "P1")?.passed === true;

export async function convert(original: string, deps: PipelineDeps): Promise<ConversionResult> {
  const { model, checker } = deps;
  const log = deps.logger ?? defaultLogger;
  const now = deps.now ?? (() => performance.now());
  const progress = (stage: PipelineStage, attempt: number) =>
    deps.onProgress?.({ type: "progress", stage, attempt, maxAttempts: MAX_ATTEMPTS });
  const started = now();
  const models: ModelUse[] = [];

  progress("analysing", 1);
  const [{ sentences, key_facts: keyFacts }, actionSynonyms] = await Promise.all([
    checker.analyse(original), // step 4
    checker.actionSynonyms(), // for the rule report
  ]);
  const sourceText = new Map(sentences.map((s) => [s.id, s.text]));

  /** The latest checked try that passed P1, if any. */
  let lastP1Pass: CheckedTry | null = null;

  /**
   * The result after the try `last`, with key-fact spans when they can be
   * had. See the header for which try that is.
   */
  const finish = async (last: CheckedTry): Promise<ConversionResult> => {
    const done = !passesP1(last) && lastP1Pass !== null ? lastP1Pass : last;
    if (done !== last) log({ msg: "pipeline_kept_earlier_try", attempt: done.attempt, of: last.attempt });
    const decided = decide(original, sentences, keyFacts, done.lines, done.checks, last.attempt, {
      judgeAvailable: done.judgeAvailable,
      models,
      actionSynonyms,
    });
    // Key-fact spans for highlighting (R5.3), from the checker so values are
    // normalised in one place. A blocked result has no lines to highlight.
    let result = decided;
    if (decided.lines.length > 0) {
      try {
        result = { ...decided, lineFacts: await checker.lineFacts({ key_facts: keyFacts, lines: decided.lines }) };
      } catch (err) {
        log({ msg: "pipeline_line_facts_failed", attempt: done.attempt, error: errorName(err) });
      }
    }
    log({
      msg: "pipeline_done",
      status: result.status,
      attempts: last.attempt,
      judgeAvailable: done.judgeAvailable,
      failedRules: result.checks.filter((c) => !c.passed).map((c) => c.rule),
      models,
      ms: Math.round(now() - started),
    });
    return result;
  };

  progress("rewriting", 1);
  const drafted = await model.rewrite({ sentences, keyFacts }); // step 5
  models.push({ task: "rewrite", attempt: 1, provider: drafted.provider, model: drafted.model });
  const ids = new LineIds();
  let lines = fromDrafts(drafted.lines, ids);
  let judgeRetried = false;

  for (let attempt = 1; ; attempt++) {
    const tryStarted = now();
    progress("checking", attempt);
    lines = await attachSymbols(lines, checker); // step 6
    const plain = toLines(lines);
    const ruleChecks = await checker.check({ original, key_facts: keyFacts, lines: plain }); // step 7, P1-P8
    const judged = await model.judge(judgePairs(lines, sourceText)); // step 8, P9-P10
    if (judged.provider !== undefined && judged.model !== undefined) {
      models.push({ task: "judge", attempt, provider: judged.provider, model: judged.model });
    }
    const checks: CheckResult[] = completeChecks([...ruleChecks.filter((c) => c.rule !== "P9" && c.rule !== "P10"), ...judged.checks]);
    const done: CheckedTry = { lines: plain, checks, attempt, judgeAvailable: judged.available };
    if (passesP1(done)) lastP1Pass = done;

    const ctx = { lines: plain, keyFacts, judgeAvailable: judged.available };
    const failed = failingLineIds(checks, ctx);
    const missing = missingFacts(checks, ctx);
    log({
      msg: "pipeline_attempt",
      attempt,
      results: checks.map((c) => ({ rule: c.rule, passed: c.passed, lines: c.line_ids.length })),
      judgeAvailable: judged.available,
      regenerateLines: failed.size,
      missingFacts: missing.length,
      ms: Math.round(now() - tryStarted),
    });

    if (attempt === MAX_ATTEMPTS) return finish(done);
    if (failed.size === 0 && missing.length === 0) {
      // Nothing to regenerate. Give an unavailable judge one more chance on the same lines.
      if (judged.available || judgeRetried) return finish(done);
      judgeRetried = true;
      continue;
    }

    progress("regenerating", attempt);
    const failing = collectFailures(plain, regenerationChecks(checks, failed, ctx), keyFacts).filter((f) =>
      failed.has(f.line.id),
    );
    let regenerated;
    try {
      regenerated = await model.regenerate({ failing, sentences, keyFacts, missingFacts: missing }); // only failing lines
    } catch (err) {
      if (!(err instanceof ModelOutputError || err instanceof ProviderChainError)) throw err;
      log({ msg: "pipeline_regenerate_failed", attempt, error: err.name });
      return finish(done);
    }
    models.push({ task: "regenerate", attempt, provider: regenerated.provider, model: regenerated.model });
    lines = applyRegeneration(lines, failed, regenerated, sentences, ids);
  }
}
