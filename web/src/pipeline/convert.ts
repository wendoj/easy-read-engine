/**
 * The convert, check and regenerate loop (design "Pipeline orchestrator").
 *
 * - Key facts come from the Original before the rewrite, so P1 compares with
 *   the source (R2.1, R2.4).
 * - Every try runs P1 to P8 on the checker and P9 and P10 in one judge call
 *   (R3.1). Only failing lines are regenerated, up to 3 tries in total (R3.3).
 * - `CheckerUnavailable` is not caught: the route returns 503, and unchecked
 *   output is never returned. Model errors from rewrite and regenerate
 *   (`ModelOutputError`, `ProviderChainError`) are not caught either.
 *
 * Judge outage: `judge()` fails P9 and P10 on every line with "judge
 * unavailable" when the judge gives no valid answer. That says nothing about
 * the lines, so it doesn't send lines to regenerate. P9 and P10 stay failed
 * and are flagged (never passed), `judgeAvailable` is false in the result,
 * and if no other rule failed the loop stops there instead of spending
 * regenerate requests. The judge has already been through its retry and
 * provider chain, so trying it again at once is unlikely to help.
 */
import type { CheckResult } from "@/src/checker-client/schemas";
import { type JudgePair, type LlmCallOptions, type ModelClient, collectFailures, judge, regenerate, rewrite } from "@/src/llm";
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

export async function convert(original: string, deps: PipelineDeps): Promise<ConversionResult> {
  const { model, checker } = deps;
  const log = deps.logger ?? defaultLogger;
  const now = deps.now ?? (() => performance.now());
  const progress = (stage: PipelineStage, attempt: number) =>
    deps.onProgress?.({ type: "progress", stage, attempt, maxAttempts: MAX_ATTEMPTS });
  const started = now();
  const models: ModelUse[] = [];

  progress("analysing", 1);
  const { sentences, key_facts: keyFacts } = await checker.analyse(original); // step 4
  const sourceText = new Map(sentences.map((s) => [s.id, s.text]));

  progress("rewriting", 1);
  const drafted = await model.rewrite({ sentences, keyFacts }); // step 5
  models.push({ task: "rewrite", attempt: 1, provider: drafted.provider, model: drafted.model });
  const ids = new LineIds();
  let lines = fromDrafts(drafted.lines, ids);

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

    if ((failed.size === 0 && missing.length === 0) || attempt === MAX_ATTEMPTS) {
      const result = decide(original, sentences, keyFacts, plain, checks, attempt, {
        judgeAvailable: judged.available,
        models,
      });
      log({
        msg: "pipeline_done",
        status: result.status,
        attempts: attempt,
        judgeAvailable: judged.available,
        failedRules: result.checks.filter((c) => !c.passed).map((c) => c.rule),
        models,
        ms: Math.round(now() - started),
      });
      return result;
    }

    progress("regenerating", attempt);
    const failing = collectFailures(plain, regenerationChecks(checks, failed, ctx), keyFacts).filter((f) =>
      failed.has(f.line.id),
    );
    const regenerated = await model.regenerate({ failing, sentences, keyFacts, missingFacts: missing }); // only failing lines
    models.push({ task: "regenerate", attempt, provider: regenerated.provider, model: regenerated.model });
    lines = applyRegeneration(lines, failed, regenerated, sentences, ids);
  }
}
