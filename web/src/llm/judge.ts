/**
 * P9 (meaning) and P10 (tone and advice) for every line, in batches.
 * If a batch gets no valid answer, its lines fail both rules with
 * "judge unavailable", so they are flagged, not hidden.
 */
import { z } from "zod";
import type { CheckResult } from "@/src/checker-client/schemas";
import { type ModelClient, ProviderChainError, ProviderRequestError } from "./client";
import { type LineVerdict, buildJudgeResults, judgeUnavailableResults, lineVerdictSchema } from "./judge-results";
import type { LlmCallOptions, ModelAnswer } from "./lines";
import { type PromptTemplate, loadPrompt, oneLine, renderPrompt } from "./prompts";
import { ModelOutputError, type ToolDefinition, callStructured } from "./structured";

export * from "./judge-results";
export type { ModelAnswer } from "./lines";

export const JUDGE_MAX_TOKENS = 2500;

export interface JudgePair {
  lineId: string;
  /** Sibling lines are grouped by this, not by text. */
  sourceSentenceId: string;
  /** Source sentence text from the Original. */
  source: string;
  /** Easy Read line text. */
  line: string;
  /**
   * Shown only as a sibling of the judged lines from the same sentence, never
   * judged itself. `/api/check` sends the unedited lines this way, so an
   * edited line isn't failed for a part that an unedited sibling says.
   */
  contextOnly?: boolean;
}

/**
 * `reason` comes before `verdict`, so the model writes the problem before it
 * decides. With the verdict first, fails often came with a reason that
 * described a pass.
 */
const VERDICT_PARAMETERS = {
  type: "object",
  properties: {
    reason: {
      type: "string",
      description: "Written first: the problem, in 15 words or fewer. Empty if there is no problem",
    },
    verdict: { type: "string", enum: ["pass", "fail"] },
  },
  required: ["reason", "verdict"],
} as const;

export const SUBMIT_VERDICTS_TOOL: ToolDefinition = {
  name: "submit_verdicts",
  description: "Submit the meaning, tone and advice verdicts for every line.",
  parameters: {
    type: "object",
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            lineId: { type: "string" },
            meaning: { ...VERDICT_PARAMETERS, description: "P9: the line keeps the meaning of its source sentence" },
            tone: { ...VERDICT_PARAMETERS, description: "P10: the tone is respectful, not childish" },
            advice: { ...VERDICT_PARAMETERS, description: "P10: fail if the line gives advice" },
          },
          required: ["lineId", "meaning", "tone", "advice"],
        },
      },
    },
    required: ["verdicts"],
  },
};

/**
 * Exactly 1 verdict for every line ID sent. A verdict for any other line ID
 * is dropped before validation: the model sometimes also judges a
 * context-only sibling, and that must not turn a valid answer into
 * "judge unavailable". A missing verdict still fails.
 */
export function judgeSchema(lineIds: readonly string[]) {
  const wanted = new Set(lineIds);
  const isOtherLine = (item: unknown) =>
    typeof item === "object" &&
    item !== null &&
    typeof (item as { lineId?: unknown }).lineId === "string" &&
    !wanted.has((item as { lineId: string }).lineId.trim());
  const verdicts = z.preprocess(
    (raw) => (Array.isArray(raw) ? raw.filter((item) => !isOtherLine(item)) : raw),
    z.array(lineVerdictSchema),
  );
  return z.object({ verdicts }).superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.verdicts.forEach((v, i) => {
      if (seen.has(v.lineId)) {
        ctx.addIssue({ code: "custom", path: ["verdicts", i, "lineId"], message: "line ID given twice" });
      }
      seen.add(v.lineId);
    });
    if (lineIds.some((id) => !seen.has(id))) {
      ctx.addIssue({ code: "custom", path: ["verdicts"], message: "a line ID has no verdict" });
    }
  });
}

const judgedLineIds = (pairs: readonly JudgePair[]) => pairs.filter((p) => !p.contextOnly).map((p) => p.lineId);

/**
 * One block per judged line. Each block also lists the other lines from the
 * same source sentence: without them the judge failed lines for leaving out
 * what a sibling line says.
 */
export function buildJudgeMessages(prompt: PromptTemplate, pairs: readonly JudgePair[]): { system: string; user: string } {
  const bySentence = new Map<string, JudgePair[]>();
  for (const p of pairs) bySentence.set(p.sourceSentenceId, [...(bySentence.get(p.sourceSentenceId) ?? []), p]);
  const blocks = pairs.filter((p) => !p.contextOnly).map((p) => {
    const others = (bySentence.get(p.sourceSentenceId) ?? []).filter((o) => o.lineId !== p.lineId);
    return [
      `Line ${p.lineId}`,
      `Source: ${oneLine(p.source)}`,
      `Easy Read: ${oneLine(p.line)}`,
      ...(others.length > 0
        ? [`Other lines from this sentence: ${others.map((o) => `${o.lineId}: ${oneLine(o.line)}`).join(" | ")}`]
        : []),
    ].join("\n");
  });
  return renderPrompt(prompt, { pairs: blocks.join("\n\n") });
}

export interface JudgeResult {
  checks: [CheckResult, CheckResult];
  /** False when some or all lines failed both rules as "judge unavailable". */
  available: boolean;
  /**
   * Empty when `available` is true. A fake may leave it out; then `available`
   * false means every line.
   */
  unavailableLineIds?: string[];
  /** The last batch that answered. */
  provider?: string;
  model?: string;
  /** Who answered each batch that answered, in order. */
  answers?: ModelAnswer[];
  requests: number;
}

/**
 * Most judged lines in 1 request. With 158 lines, the Bedrock judge's answer
 * was cut off twice, so every line failed as "judge unavailable".
 */
export const JUDGE_BATCH_LINES = 40;

/**
 * Every pair from a sentence (judged or context-only) goes in the same batch,
 * so the judge always sees a line's siblings. A batch holds at most `size`
 * judged lines, unless 1 sentence alone has more. Sentences with no judged
 * line are left out.
 */
export function judgeBatches(pairs: readonly JudgePair[], size: number = JUDGE_BATCH_LINES): JudgePair[][] {
  const judgedPerSentence = new Map<string, number>();
  for (const p of pairs) {
    if (!p.contextOnly) judgedPerSentence.set(p.sourceSentenceId, (judgedPerSentence.get(p.sourceSentenceId) ?? 0) + 1);
  }
  const batches: Set<string>[] = [];
  let current = new Set<string>();
  let count = 0;
  for (const [sentenceId, n] of judgedPerSentence) {
    if (count > 0 && count + n > size) {
      batches.push(current);
      current = new Set();
      count = 0;
    }
    current.add(sentenceId);
    count += n;
  }
  if (count > 0) batches.push(current);
  return batches.map((ids) => pairs.filter((p) => ids.has(p.sourceSentenceId)));
}

type BatchOutcome =
  | { ok: true; lineIds: string[]; verdicts: LineVerdict[]; provider: string; model: string; requests: number }
  | { ok: false; lineIds: string[]; requests: number };

async function judgeBatch(
  client: ModelClient,
  prompt: PromptTemplate,
  pairs: readonly JudgePair[],
  options: LlmCallOptions,
): Promise<BatchOutcome> {
  const lineIds = judgedLineIds(pairs);
  const { system, user } = buildJudgeMessages(prompt, pairs);
  try {
    const result = await callStructured(
      client,
      {
        task: "judge",
        role: "judge",
        system,
        user,
        tool: SUBMIT_VERDICTS_TOOL,
        schema: judgeSchema(lineIds),
        maxTokens: JUDGE_MAX_TOKENS,
        temperature: 0,
      },
      options,
    );
    const { provider, model, requests } = result;
    return { ok: true, lineIds, verdicts: result.data.verdicts, provider, model, requests };
  } catch (err) {
    // Any model failure (invalid output, rejected request, every provider down) flags both rules.
    if (err instanceof ModelOutputError) return { ok: false, lineIds, requests: err.requests };
    if (err instanceof ProviderRequestError || err instanceof ProviderChainError) return { ok: false, lineIds, requests: 1 };
    throw err;
  }
}

/**
 * Batches run in order. A batch with no valid answer fails its lines as
 * "judge unavailable"; the other batches keep their verdicts. Results list
 * lines in the order of `pairs`.
 */
export async function judge(
  client: ModelClient,
  pairs: readonly JudgePair[],
  options: LlmCallOptions = {},
): Promise<JudgeResult> {
  const lineIds = judgedLineIds(pairs);
  if (lineIds.length === 0) {
    return { checks: buildJudgeResults([], []), available: true, unavailableLineIds: [], answers: [], requests: 0 };
  }
  const prompt = options.prompt ?? (await loadPrompt("judge"));
  const outcomes: BatchOutcome[] = [];
  for (const batch of judgeBatches(pairs)) outcomes.push(await judgeBatch(client, prompt, batch, options));

  const unavailable = new Set(outcomes.flatMap((o) => (o.ok ? [] : o.lineIds)));
  const verdicts = outcomes.flatMap((o) => (o.ok ? o.verdicts : []));
  const [judged9, judged10] = buildJudgeResults(lineIds.filter((id) => !unavailable.has(id)), verdicts);
  const [missing9, missing10] = judgeUnavailableResults(lineIds.filter((id) => unavailable.has(id)));
  const order = new Map(lineIds.map((id, i) => [id, i]));
  const merge = (a: CheckResult, b: CheckResult): CheckResult => {
    const ids = [...a.line_ids, ...b.line_ids].sort((x, y) => order.get(x)! - order.get(y)!);
    const details = [...a.details, ...b.details];
    const firstId = (d: string) => order.get(d.split(" ", 1)[0]) ?? 0;
    return { ...a, passed: ids.length === 0, line_ids: ids, details: details.sort((x, y) => firstId(x) - firstId(y)) };
  };
  const answers = outcomes.flatMap((o) => (o.ok ? [{ provider: o.provider, model: o.model }] : []));
  const answered = answers.at(-1);
  return {
    checks: [merge(judged9, missing9), merge(judged10, missing10)],
    available: unavailable.size === 0,
    unavailableLineIds: lineIds.filter((id) => unavailable.has(id)),
    ...(answered ? { provider: answered.provider, model: answered.model } : {}),
    answers,
    requests: outcomes.reduce((n, o) => n + o.requests, 0),
  };
}
