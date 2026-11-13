/**
 * The convert, check and regenerate loop. Rules a future edit could break:
 *
 * - Errors that propagate, so the route returns 503 or 502 and unchecked
 *   output is never returned: `CheckerUnavailable` from `analyse`, `symbols`
 *   or `check`, any error from the first rewrite, and regenerate errors other
 *   than `ModelOutputError` and `ProviderChainError`.
 * - The result is the last try, unless it fails P1 and an earlier try passed
 *   P1. Then the latest try that passed P1 is the result, with its own checks.
 *   `attempts` still counts every try.
 * - If regenerate fails with `ModelOutputError` or `ProviderChainError`, or
 *   `lineFacts` throws, the last checked try is decided as if it were the last
 *   try (failing rules are flagged, P1 still blocks). Log the error name only.
 * - Judge outage: "judge unavailable" lines are not sent to regenerate for P9
 *   or P10, and those rules stay failed. If nothing else needs regenerating,
 *   the judge gets one second chance on only those lines, once per conversion.
 */
import type { CheckResult, Line } from "@/src/checker-client/schemas";
import {
  type JudgePair,
  type JudgeResult,
  type LlmCallOptions,
  type ModelAnswer,
  type ModelClient,
  ModelOutputError,
  ProviderChainError,
  collectFailures,
  judge,
  regenerate,
  rewrite,
} from "@/src/llm";
import { mergeJudgeChecks } from "@/src/check/merge";
import {
  type FailureContext,
  MAX_ATTEMPTS,
  completeChecks,
  decide,
  failingLineIds,
  missingFacts,
  regenerationChecks,
} from "./decide";
import { LineIds, type WorkingLine, applyRegeneration, fromDrafts, toLines } from "./lines";
import { judgeSourceText } from "./source-text";
import { splitConditions } from "./split-conditions";
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

export function modelFromClient(client: ModelClient, options: LlmCallOptions = {}): PipelineModel {
  return {
    rewrite: (input) => rewrite(client, input, options),
    regenerate: (input) => regenerate(client, input, options),
    judge: (pairs) => judge(client, pairs, options),
  };
}

function judgePairs(lines: readonly WorkingLine[], sourceText: ReadonlyMap<string, string>): JudgePair[] {
  return lines.map((l) => ({
    lineId: l.id,
    sourceSentenceId: l.source_sentence_id,
    source: sourceText.get(l.source_sentence_id) ?? "",
    line: l.text,
  }));
}

/** Fakes may give a single answer instead of `answers`. */
function answersOf(r: { provider?: string; model?: string; answers?: ModelAnswer[] }): ModelAnswer[] {
  if (r.answers) return r.answers;
  return r.provider !== undefined && r.model !== undefined ? [{ provider: r.provider, model: r.model }] : [];
}

const errorName = (err: unknown) => (err instanceof Error ? err.name : "unknown");

interface CheckedTry {
  lines: Line[];
  checks: CheckResult[];
  attempt: number;
  judgeAvailable: boolean;
}

/** The P9 and P10 results to keep, and the lines to judge again. */
interface Rejudge {
  checks: CheckResult[];
  lineIds: ReadonlySet<string>;
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
    checker.analyse(original),
    checker.actionSynonyms(),
  ]);
  const sourceText = judgeSourceText(sentences);

  /**
   * On the judge's second chance (`rejudge`), only the lines that got no
   * answer are judged, with their siblings as context. The other lines keep
   * the verdicts they already had.
   */
  const judgeTry = async (
    current: readonly WorkingLine[],
    rejudge: Rejudge | null,
  ): Promise<JudgeResult> => {
    const pairs = judgePairs(current, sourceText);
    if (rejudge === null) return model.judge(pairs);
    const sentencesToJudge = new Set(pairs.filter((p) => rejudge.lineIds.has(p.lineId)).map((p) => p.sourceSentenceId));
    const judged = await model.judge(
      pairs
        .filter((p) => sentencesToJudge.has(p.sourceSentenceId))
        .map((p) => (rejudge.lineIds.has(p.lineId) ? p : { ...p, contextOnly: true })),
    );
    const carried = new Set(pairs.map((p) => p.lineId).filter((id) => !rejudge.lineIds.has(id)));
    const unavailable = judged.unavailableLineIds ?? (judged.available ? [] : [...rejudge.lineIds]);
    return {
      ...judged,
      checks: mergeJudgeChecks(rejudge.checks, judged.checks, carried),
      available: unavailable.length === 0,
      unavailableLineIds: unavailable,
    };
  };

  let lastP1Pass: CheckedTry | null = null;

  /** If `last` fails P1, the latest try that passed P1 is the result. See the header. */
  const finish = async (last: CheckedTry): Promise<ConversionResult> => {
    const done = !passesP1(last) && lastP1Pass !== null ? lastP1Pass : last;
    if (done !== last) log({ msg: "pipeline_kept_earlier_try", attempt: done.attempt, of: last.attempt });
    const decided = decide(original, sentences, keyFacts, done.lines, done.checks, last.attempt, {
      judgeAvailable: done.judgeAvailable,
      models,
      actionSynonyms,
    });
    // Spans come from the checker so values are normalised in one place.
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
  const drafted = await model.rewrite({ sentences, keyFacts });
  for (const a of answersOf(drafted)) models.push({ task: "rewrite", attempt: 1, ...a });
  const ids = new LineIds();
  let lines = fromDrafts(splitConditions(drafted.lines), ids);
  let judgeRetried = false;
  /** Set only for the judge's second chance. */
  let rejudge: Rejudge | null = null;

  for (let attempt = 1; ; attempt++) {
    const tryStarted = now();
    progress("checking", attempt);
    lines = await attachSymbols(lines, checker);
    const plain = toLines(lines);
    const ruleChecks = await checker.check({ original, key_facts: keyFacts, lines: plain });
    const judged = await judgeTry(lines, rejudge);
    rejudge = null;
    for (const a of answersOf(judged)) models.push({ task: "judge", attempt, ...a });
    const checks: CheckResult[] = completeChecks([...ruleChecks.filter((c) => c.rule !== "P9" && c.rule !== "P10"), ...judged.checks]);
    const done: CheckedTry = { lines: plain, checks, attempt, judgeAvailable: judged.available };
    if (passesP1(done)) lastP1Pass = done;

    const ctx: FailureContext = {
      lines: plain,
      keyFacts,
      judgeAvailable: judged.available,
      ...(judged.unavailableLineIds ? { judgeUnavailableLineIds: new Set(judged.unavailableLineIds) } : {}),
    };
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
      rejudge = {
        checks: judged.checks,
        lineIds: new Set(judged.unavailableLineIds ?? plain.map((l) => l.id)),
      };
      continue;
    }

    progress("regenerating", attempt);
    const failing = collectFailures(plain, regenerationChecks(checks, failed, ctx), keyFacts).filter((f) =>
      failed.has(f.line.id),
    );
    let regenerated;
    try {
      regenerated = await model.regenerate({ failing, sentences, keyFacts, missingFacts: missing });
    } catch (err) {
      if (!(err instanceof ModelOutputError || err instanceof ProviderChainError)) throw err;
      log({ msg: "pipeline_regenerate_failed", attempt, error: err.name });
      return finish(done);
    }
    models.push({ task: "regenerate", attempt, provider: regenerated.provider, model: regenerated.model });
    const split = {
      replacements: regenerated.replacements.map((r) => ({ ...r, lines: splitConditions(r.lines) })),
      added: splitConditions(regenerated.added),
    };
    lines = applyRegeneration(lines, failed, split, sentences, ids);
  }
}
