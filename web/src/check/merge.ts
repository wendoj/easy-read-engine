/**
 * Pure: carry P9 and P10 verdicts over for lines that weren't edited, and add
 * the judge's new verdicts for the edited lines (R9.2).
 *
 * Judge results name failing lines in `line_ids`, and every detail starts with
 * its line ID (see `buildJudgeResults`). A carried-over failure is kept only
 * for a line that is still in the output and wasn't edited. A previous result
 * that failed without naming any line (for example "no result for this rule")
 * stays failed, so a gap is never turned into a pass.
 */
import type { CheckResult } from "@/src/checker-client/schemas";
import { JUDGE_UNAVAILABLE } from "@/src/llm/judge";

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
 * P9 and P10 for the whole output after an edit.
 *
 * @param previous the checks the client had before the edit (all 10 rules; only P9 and P10 are read)
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

/** False when any P9 or P10 failure, new or carried over, is "judge unavailable". */
export function judgeAvailableAfterMerge(merged: readonly CheckResult[], judgedAvailable: boolean): boolean {
  if (!judgedAvailable) return false;
  return !merged.some((c) => c.details.some((d) => d.endsWith(` ${JUDGE_UNAVAILABLE}`)));
}
