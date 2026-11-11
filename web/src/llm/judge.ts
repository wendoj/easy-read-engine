/**
 * Judge: P9 (meaning) and P10 (tone and advice) for every line in one
 * request (design "Judges"). Prompt: `prompts/judge.md`.
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
  /** Source sentence text from the Original. */
  source: string;
  /** Easy Read line text. */
  line: string;
}

const verdictSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  reason: z.string().default(""),
});

export const lineVerdictSchema = z.object({
  lineId: z.string().trim(),
  meaning: verdictSchema,
  tone: verdictSchema,
  advice: verdictSchema,
});

export type Verdict = z.infer<typeof verdictSchema>;
export type LineVerdict = z.infer<typeof lineVerdictSchema>;

const VERDICT_PARAMETERS = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["pass", "fail"] },
    reason: { type: "string", description: "Why it fails, in 15 words or fewer. Empty for a pass" },
  },
  required: ["verdict", "reason"],
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

/** Exactly 1 verdict for every line ID sent, and no other IDs. */
export function judgeSchema(lineIds: readonly string[]) {
  return z.object({ verdicts: z.array(lineVerdictSchema) }).superRefine((value, ctx) => {
    const wanted = new Set(lineIds);
    const seen = new Set<string>();
    value.verdicts.forEach((v, i) => {
      if (!wanted.has(v.lineId)) {
        ctx.addIssue({ code: "custom", path: ["verdicts", i, "lineId"], message: "not a line ID from the list" });
      } else if (seen.has(v.lineId)) {
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
 * couldn't see the siblings.
 */
export function buildJudgeMessages(prompt: PromptTemplate, pairs: readonly JudgePair[]): { system: string; user: string } {
  const bySource = new Map<string, JudgePair[]>();
  for (const p of pairs) bySource.set(p.source, [...(bySource.get(p.source) ?? []), p]);
  const blocks = pairs.map((p) => {
    const others = (bySource.get(p.source) ?? []).filter((o) => o.lineId !== p.lineId);
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

export async function judge(
  client: ModelClient,
  pairs: readonly JudgePair[],
  options: LlmCallOptions = {},
): Promise<JudgeResult> {
  const lineIds = pairs.map((p) => p.lineId);
  if (lineIds.length === 0) return { checks: buildJudgeResults([], []), available: true, requests: 0 };
  const prompt = options.prompt ?? (await loadPrompt("judge"));
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
    return {
      checks: buildJudgeResults(lineIds, result.data.verdicts),
      available: true,
      provider: result.provider,
      model: result.model,
      requests: result.requests,
    };
  } catch (err) {
    // Any model failure (invalid output, rejected request, every provider down) flags both rules.
    if (err instanceof ModelOutputError) {
      return { checks: judgeUnavailableResults(lineIds), available: false, requests: err.requests };
    }
    if (err instanceof ProviderRequestError || err instanceof ProviderChainError) {
      return { checks: judgeUnavailableResults(lineIds), available: false, requests: 1 };
    }
    throw err;
  }
}
