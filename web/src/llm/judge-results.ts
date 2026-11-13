/** Pure: turn the judge's per-line verdicts into the P9 and P10 check results. */
import { z } from "zod";
import type { CheckResult } from "@/src/checker-client/schemas";
import { oneLine } from "./prompts";

/** Longest reason kept in a check result. */
export const MAX_REASON_CHARS = 200;
export const JUDGE_UNAVAILABLE = "judge unavailable";

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

function reasonText(kind: string, v: Verdict): string {
  const reason = oneLine(v.reason).slice(0, MAX_REASON_CHARS);
  return reason ? `${kind}: ${reason}` : kind;
}

const emptyResult = (rule: "P9" | "P10"): CheckResult => ({
  rule,
  passed: true,
  line_ids: [],
  failed_fact_ids: [],
  details: [],
});

/**
 * - P9 fails on a line whose meaning verdict fails.
 * - P10 fails on a line whose tone or advice verdict fails.
 * - A line with no verdict fails both rules, so a gap is never a pass.
 * - Verdicts for line IDs not in `lineIds` are ignored.
 * - `line_ids` lists the failing lines, and every detail starts with its line ID.
 */
export function buildJudgeResults(lineIds: readonly string[], verdicts: readonly LineVerdict[]): [CheckResult, CheckResult] {
  const byId = new Map<string, LineVerdict>();
  for (const v of verdicts) if (!byId.has(v.lineId)) byId.set(v.lineId, v);

  const p9 = emptyResult("P9");
  const p10 = emptyResult("P10");

  for (const id of lineIds) {
    const v = byId.get(id);
    if (!v) {
      for (const r of [p9, p10]) {
        r.line_ids.push(id);
        r.details.push(`${id} has no verdict from the judge`);
      }
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

/** Both rules fail on every line, so a judge outage is flagged, never passed. */
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
