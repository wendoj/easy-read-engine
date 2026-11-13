/**
 * Carries P9 and P10 over for lines that weren't edited and adds the judge's
 * new verdicts for the edited ones. A carried-over failure is kept only for a
 * line that is still there and unedited. A failure that names no line (such as
 * "no result for this rule") stays failed, so a gap never turns into a pass.
 */
import type { CheckResult } from "@/src/checker-client/schemas";
import { JUDGE_UNAVAILABLE } from "@/src/llm/judge";
import { completeChecks } from "@/src/pipeline/decide";

export type JudgeRule = "P9" | "P10";
export const JUDGE_RULES: readonly JudgeRule[] = ["P9", "P10"];

/** The line ID a judge detail is about: the text before the first space. */
export function detailLineId(detail: string): string {
  const space = detail.indexOf(" ");
  return space < 0 ? detail : detail.slice(0, space);
}

function mergeOne(
  rule: JudgeRule,
  previous: CheckResult | undefined,
  judged: CheckResult | undefined,
  carried: ReadonlySet<string>,
): CheckResult {
  const lineIds: string[] = [];
  const details: string[] = [];
  let unnamedFailure = false;
  if (previous && !previous.passed) {
    if (previous.line_ids.length === 0) {
      unnamedFailure = true;
      details.push(...previous.details);
    } else {
      for (const id of previous.line_ids) if (carried.has(id) && !lineIds.includes(id)) lineIds.push(id);
      for (const d of previous.details) if (carried.has(detailLineId(d))) details.push(d);
    }
  }
  if (judged && !judged.passed) {
    for (const id of judged.line_ids) if (!lineIds.includes(id)) lineIds.push(id);
    details.push(...judged.details);
    if (judged.line_ids.length === 0) unnamedFailure = true;
  }
  return { rule, passed: lineIds.length === 0 && !unnamedFailure, line_ids: lineIds, failed_fact_ids: [], details };
}

/**
 * @param previous the client's checks before the edit (only P9 and P10 are read)
 * @param judged the judge's P9 and P10 for the edited lines only
 * @param carried IDs of current lines that weren't edited
 */
export function mergeJudgeChecks(
  previous: readonly CheckResult[],
  judged: readonly CheckResult[],
  carried: ReadonlySet<string>,
): [CheckResult, CheckResult] {
  const [p9, p10] = JUDGE_RULES.map((rule) =>
    mergeOne(
      rule,
      previous.find((c) => c.rule === rule),
      judged.find((c) => c.rule === rule),
      carried,
    ),
  );
  return [p9, p10];
}

/** The checker's P1 to P8 plus the merged P9 and P10, as all 10 rules in order. */
export function withJudgeChecks(ruleChecks: readonly CheckResult[], judgeChecks: readonly CheckResult[]): CheckResult[] {
  return completeChecks([...ruleChecks.filter((c) => c.rule !== "P9" && c.rule !== "P10"), ...judgeChecks]);
}

/** False when any P9 or P10 failure, new or carried over, is "judge unavailable". */
export function judgeAvailableAfterMerge(merged: readonly CheckResult[], judgedAvailable: boolean): boolean {
  if (!judgedAvailable) return false;
  return !merged.some((c) => c.details.some((d) => d.endsWith(` ${JUDGE_UNAVAILABLE}`)));
}
