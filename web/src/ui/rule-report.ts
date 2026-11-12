/**
 * Pure logic behind the pass count and the rule report (task 24, R3.4, R6.1 to R6.3).
 *
 * - The report always has one row per rule, P1 to P10 in order. A rule with no
 *   result counts as failed, so a missing result is never shown as a pass.
 * - When the judge was unavailable, P9 and P10 are failed with
 *   `JUDGE_UNAVAILABLE_REASON`, whatever their results say, and they put no
 *   marker on the lines: the failure says nothing about any line.
 * - Browser-safe: imports only types and the rule list.
 */
import type { CheckResult, KeyFact } from "@/src/checker-client/schemas";
import { RULES } from "@/src/pipeline/decide";
import type { ConversionResult, Rule } from "@/src/pipeline/types";

export const TOTAL_RULES = RULES.length;

/** Plain-language rule names, matching the Rule set in requirements.md. */
export const RULE_NAMES: Record<Rule, string> = {
  P1: "Key facts match the letter",
  P2: "Short sentences",
  P3: "One idea in each sentence",
  P4: "Says who does each action",
  P5: "Plain words",
  P6: "Numbers written as digits",
  P7: "Short forms explained",
  P8: "Pictures from the picture library",
  P9: "Keeps the meaning of the letter",
  P10: "Respectful tone with no advice",
};

export const JUDGE_UNAVAILABLE_REASON = "The meaning and tone check was not available";

const JUDGE_RULES: ReadonlySet<Rule> = new Set(["P9", "P10"]);

const FACT_TYPE_NAMES: Record<KeyFact["type"], string> = {
  date: "Date",
  time: "Time",
  money: "Money",
  reference: "Reference number",
  phone: "Phone number",
  address: "Address",
  action: "Action",
};

/** What the report needs from a result. Fits a `ConversionResult`. */
export type ReportInput = Pick<ConversionResult, "checks" | "lines" | "keyFacts" | "judgeAvailable">;

export interface FailedFact {
  id: string;
  /** For example "Phone number". */
  label: string;
  /** The value as written in the Original. */
  value: string;
}

export interface RuleRow {
  rule: Rule;
  name: string;
  passed: boolean;
  /** "Passed" or "Failed", so colour is never the only signal. */
  resultLabel: "Passed" | "Failed";
  /** Lines the rule applied to, in screen order, with their label: "Line 1", "Line 3". */
  lines: RuleLine[];
  /** Short reasons from the check (`details`). */
  reasons: string[];
  /** P1 only: the key facts that failed, with their values from the Original. */
  failedFacts: FailedFact[];
}

export interface RuleLine {
  /** The line's ID, to find it on screen or in print. */
  id: string;
  /** Its place on screen, from 1. */
  number: number;
  /** "Line 3". */
  label: string;
}

export interface PassCount {
  passed: number;
  total: number;
  /** For example "10 of 10 checks passed". */
  label: string;
}

/** The result for each rule, P1 to P10, with the judge-unavailable rule applied. */
function effectiveChecks(input: Pick<ReportInput, "checks" | "judgeAvailable">): Map<Rule, CheckResult> {
  const byRule = new Map<Rule, CheckResult>();
  for (const c of input.checks) if (!byRule.has(c.rule)) byRule.set(c.rule, c);
  const out = new Map<Rule, CheckResult>();
  for (const rule of RULES) {
    const found = byRule.get(rule);
    if (!input.judgeAvailable && JUDGE_RULES.has(rule)) {
      out.set(rule, { rule, passed: false, line_ids: [], failed_fact_ids: [], details: [JUDGE_UNAVAILABLE_REASON] });
    } else {
      out.set(
        rule,
        found ?? { rule, passed: false, line_ids: [], failed_fact_ids: [], details: ["No result for this check"] },
      );
    }
  }
  return out;
}

export function passCount(input: Pick<ReportInput, "checks" | "judgeAvailable">): PassCount {
  const passed = [...effectiveChecks(input).values()].filter((c) => c.passed).length;
  return { passed, total: TOTAL_RULES, label: `${passed} of ${TOTAL_RULES} checks passed` };
}

export function ruleRows(input: ReportInput): RuleRow[] {
  const position = new Map(input.lines.map((l, i) => [l.id, i + 1]));
  const facts = new Map(input.keyFacts.map((f) => [f.id, f]));
  return [...effectiveChecks(input).values()].map((c) => {
    const lines = [...new Set(c.line_ids)]
      .flatMap((id) => {
        const number = position.get(id);
        return number === undefined ? [] : [{ id, number, label: `Line ${number}` }];
      })
      .sort((a, b) => a.number - b.number);
    const failedFacts = c.failed_fact_ids
      .map((id) => facts.get(id))
      .filter((f): f is KeyFact => f !== undefined)
      .map((f) => ({ id: f.id, label: FACT_TYPE_NAMES[f.type], value: f.value }));
    return {
      rule: c.rule,
      name: RULE_NAMES[c.rule],
      passed: c.passed,
      resultLabel: c.passed ? "Passed" : "Failed",
      lines,
      reasons: c.details,
      failedFacts,
    };
  });
}

/**
 * Failed rules for each line, in rule order. Only lines with at least one
 * failed rule are in the map.
 */
export function lineMarkers(input: Pick<ReportInput, "checks" | "lines" | "judgeAvailable">): Map<string, Rule[]> {
  const current = new Set(input.lines.map((l) => l.id));
  const out = new Map<string, Rule[]>();
  for (const c of effectiveChecks(input).values()) {
    if (c.passed) continue;
    for (const id of new Set(c.line_ids)) {
      if (!current.has(id)) continue;
      out.set(id, [...(out.get(id) ?? []), c.rule]);
    }
  }
  return out;
}

const FACT_TYPE_PLURALS: Record<KeyFact["type"], string> = {
  date: "dates",
  time: "times",
  money: "money amounts",
  reference: "reference numbers",
  phone: "phone numbers",
  address: "addresses",
  action: "instructions",
};
const FACT_TYPE_ORDER: KeyFact["type"][] = ["date", "time", "money", "reference", "phone", "address", "action"];

export interface FactSummary {
  /** P1 passed. */
  matched: boolean;
  /** "All 14 key facts match the letter". */
  label: string;
  /** "Checked: dates, money amounts and instructions." Empty when the letter has no key facts. */
  detail: string;
}

/** "a", "a and b", "a, b and c". */
function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * The headline of the result: whether every key fact (P1) matches the
 * letter. It comes first because it is the promise that matters most to a
 * reader: no date, amount or instruction was changed. The other 9 checks are
 * in the pass count and the report.
 */
export function factSummary(input: Pick<ReportInput, "checks" | "judgeAvailable" | "keyFacts">): FactSummary {
  const p1 = effectiveChecks(input).get("P1");
  const total = input.keyFacts.length;
  const types = FACT_TYPE_ORDER.filter((t) => input.keyFacts.some((f) => f.type === t)).map(
    (t) => FACT_TYPE_PLURALS[t],
  );
  const words = listWords(types);
  const detail = words ? `Checked: ${words}.` : "";
  if (p1?.passed) {
    if (total === 0) return { matched: true, label: "No dates, amounts or instructions to check", detail };
    const label = total === 1 ? "The 1 key fact matches the letter" : `All ${total} key facts match the letter`;
    return { matched: true, label, detail };
  }
  const failed = new Set(p1?.failed_fact_ids ?? []).size;
  const label =
    failed > 0 && total > 0
      ? `${failed} of ${total} key ${total === 1 ? "fact" : "facts"} ${failed === 1 ? "does" : "do"} not match the letter`
      : "Some key facts do not match the letter";
  return { matched: false, label, detail };
}
