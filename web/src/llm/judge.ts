/**
 * Judge: P9 (meaning) and P10 (tone and advice) for every line, in batches
 * of up to `JUDGE_BATCH_LINES` lines, 1 request each (design "Judges").
 * Prompt: `prompts/judge.md`.
 *
 * A line fails P10 if its tone verdict or its advice verdict fails (R7.3).
 * If the judge gives no valid answer, both rules fail with "judge
 * unavailable", so they are flagged, not hidden (design "Error Handling").
 */
import { z } from "zod";
import type { CheckResult } from "@/src/checker-client/schemas";
import { type ModelClient, ProviderChainError, ProviderRequestError } from "./client";
import { type PromptTemplate, loadPrompt, oneLine, renderTemplate } from "./prompts";
import type { LlmCallOptions } from "./rewrite";
import { ModelOutputError, type ToolDefinition, callStructured } from "./structured";

export const JUDGE_MAX_TOKENS = 2500;
/** Longest reason kept in a check result. */
export const MAX_REASON_CHARS = 200;
export const JUDGE_UNAVAILABLE = "judge unavailable";

export interface JudgePair {
  lineId: string;
  /** ID of the line's source sentence. Sibling lines are grouped by this, not by text. */
  sourceSentenceId: string;
  /** Source sentence text from the Original. */
  source: string;
  /** Easy Read line text. */
  line: string;
  /**
   * Shown to the judge only as a sibling of the judged lines from the same
   * sentence, never judged itself and given no verdict. `/api/check` sends
   * the unedited lines this way, so an edited line isn't failed for a part
   * that an unedited sibling says.
   */
  contextOnly?: boolean;
}

const verdictSchema = z.object({
  reason: z.string().default(""),
  verdict: z.enum(["pass", "fail"]),
});

export const lineVerdictSchema = z.object({
  lineId: z.string().trim(),
  meaning: verdictSchema,
  tone: verdictSchema,
  advice: verdictSchema,
});

export type Verdict = z.infer<typeof verdictSchema>;
export type LineVerdict = z.infer<typeof lineVerdictSchema>;

/**
 * `reason` comes before `verdict`, so the model writes the problem before it
 * decides. With the verdict first, the recorded samples (November 2026) had
 * fails whose own reason described a pass ("Leaves out X, which other lines
 * cover").
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
 * context-only sibling it was shown, and that extra verdict must not turn a
 * valid answer into "judge unavailable". A missing verdict still fails.
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

function reasonText(kind: string, v: Verdict): string {
  const reason = oneLine(v.reason).slice(0, MAX_REASON_CHARS);
  return reason ? `${kind}: ${reason}` : kind;
}

/**
 * Pure: turn per-line verdicts into the P9 and P10 check results.
 *
 * - P9 fails on a line whose meaning verdict fails.
 * - P10 fails on a line whose tone verdict or advice verdict fails.
 * - A line with no verdict fails both rules, so a gap is never a pass.
 * - Verdicts for line IDs not in `lineIds` are ignored.
 * - `line_ids` lists the failing lines, and every detail starts with its line ID.
 */
export function buildJudgeResults(lineIds: readonly string[], verdicts: readonly LineVerdict[]): [CheckResult, CheckResult] {
  const byId = new Map<string, LineVerdict>();
  for (const v of verdicts) if (!byId.has(v.lineId)) byId.set(v.lineId, v);

  const p9: CheckResult = { rule: "P9", passed: true, line_ids: [], failed_fact_ids: [], details: [] };
  const p10: CheckResult = { rule: "P10", passed: true, line_ids: [], failed_fact_ids: [], details: [] };

  for (const id of lineIds) {
    const v = byId.get(id);
    if (!v) {
      p9.line_ids.push(id);
      p9.details.push(`${id} has no verdict from the judge`);
      p10.line_ids.push(id);
      p10.details.push(`${id} has no verdict from the judge`);
      continue;
    }
    if (v.meaning.verdict === "fail") {
      p9.line_ids.push(id);
      p9.details.push(`${id} ${reasonText("meaning", v.meaning)}`);
    }
    const toneFailed = v.tone.verdict === "fail";
    const adviceFailed = v.advice.verdict === "fail";
    if (toneFailed || adviceFailed) {
      p10.line_ids.push(id);
      if (toneFailed) p10.details.push(`${id} ${reasonText("tone", v.tone)}`);
      if (adviceFailed) p10.details.push(`${id} ${reasonText("advice", v.advice)}`);
    }
  }
  p9.passed = p9.line_ids.length === 0;
  p10.passed = p10.line_ids.length === 0;
  return [p9, p10];
}

/** Both rules fail on every line, with the reason "judge unavailable". */
export function judgeUnavailableResults(lineIds: readonly string[]): [CheckResult, CheckResult] {
  const make = (rule: "P9" | "P10"): CheckResult => ({
    rule,
    passed: lineIds.length === 0,
    line_ids: [...lineIds],
    failed_fact_ids: [],
    details: lineIds.map((id) => `${id} ${JUDGE_UNAVAILABLE}`),
  });
  return [make("P9"), make("P10")];
}

/**
 * One block per line. A long sentence is split over several lines (P3), so
 * each block also lists the other lines from the same source sentence. The
 * judge failed lines for leaving out what a sibling line says, because it
 * couldn't see the siblings. Siblings are grouped by sentence ID, so 2
 * sentences with the same text don't share siblings. A `contextOnly` pair
 * gets no block of its own and appears only as a sibling.
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
  return { system: prompt.system, user: renderTemplate(prompt.user, { pairs: blocks.join("\n\n") }) };
}

export interface JudgeResult {
  checks: [CheckResult, CheckResult];
  /** False when the judge gave no valid answer and both rules were failed as "judge unavailable". */
  available: boolean;
  provider?: string;
  model?: string;
  requests: number;
}

/**
 * Most judged lines in 1 request. With 158 lines, the Bedrock judge's answer
 * was invalid twice (cut off), so every line failed as "judge unavailable"
 * (re-recorded samples, November 2026). About 100 lines still worked.
 */
export const JUDGE_BATCH_LINES = 40;

/**
 * Split `pairs` into batches of whole sentences, in order: every pair from a
 * sentence (judged or context-only) goes in the same batch, so the judge
 * always sees a line's siblings. A batch holds at most `size` judged lines,
 * unless 1 sentence alone has more. Sentences with no judged line are left out.
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
  const lineIds = pairs.filter((p) => !p.contextOnly).map((p) => p.lineId);
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
 * Judges the lines in batches (`judgeBatches`), one request each, in order.
 * If any batch gets no valid answer, its lines fail both rules as "judge
 * unavailable" and `available` is false; the other batches keep their
 * verdicts. Results list lines in the order of `pairs`.
 */
export async function judge(
  client: ModelClient,
  pairs: readonly JudgePair[],
  options: LlmCallOptions = {},
): Promise<JudgeResult> {
  const lineIds = pairs.filter((p) => !p.contextOnly).map((p) => p.lineId);
  if (lineIds.length === 0) return { checks: buildJudgeResults([], []), available: true, requests: 0 };
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
  const answered = outcomes.filter((o) => o.ok).at(-1);
  return {
    checks: [merge(judged9, missing9), merge(judged10, missing10)],
    available: unavailable.size === 0,
    ...(answered?.ok ? { provider: answered.provider, model: answered.model } : {}),
    requests: outcomes.reduce((n, o) => n + o.requests, 0),
  };
}
