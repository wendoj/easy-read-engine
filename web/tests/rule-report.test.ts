import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CheckResult, KeyFact, Line } from "@/src/checker-client/schemas";
import { RULES } from "@/src/pipeline/decide";
import type { Rule } from "@/src/pipeline/types";
import {
  JUDGE_UNAVAILABLE_REASON,
  RULE_NAMES,
  TOTAL_RULES,
  factSummary,
  lineMarkers,
  passCount,
  ruleRows,
} from "@/src/ui/rule-report";

// Invented lines only. No letter text.
const LINES: Line[] = [
  { id: "l1", text: "The council will repair your boiler.", source_sentence_id: "s1", symbol_id: null },
  { id: "l2", text: "The repair is on 3 March 2026.", source_sentence_id: "s1", symbol_id: null },
  { id: "l3", text: "The letter gives a phone number: 0300 123 4567.", source_sentence_id: "s2", symbol_id: null },
];
const PHONE: KeyFact = {
  id: "k1",
  type: "phone",
  value: "0300 123 4567",
  normalised: "03001234567",
  start: 0,
  end: 13,
  sentence_id: "s2",
};

function checks(failed: Partial<Record<Rule, string[]>> = {}): CheckResult[] {
  return RULES.map((rule) => ({
    rule,
    passed: !(rule in failed),
    line_ids: failed[rule] ?? [],
    failed_fact_ids: [],
    details: rule in failed ? [`${rule} reason`] : [],
  }));
}

function input(
  overrides: { checks?: CheckResult[]; lines?: Line[]; judgeAvailable?: boolean; keyFacts?: KeyFact[] } = {},
) {
  return { checks: checks(), lines: LINES, keyFacts: [], judgeAvailable: true, ...overrides };
}

describe("passCount", () => {
  it("says 10 of 10 checks passed when every rule passed", () => {
    expect(passCount(input())).toEqual({ passed: 10, total: 10, label: "10 of 10 checks passed" });
  });

  it("counts a missing rule as failed", () => {
    expect(passCount(input({ checks: checks().filter((c) => c.rule !== "P5") })).passed).toBe(9);
  });

  it("never counts P9 and P10 as passed when the judge was unavailable", () => {
    expect(passCount(input({ judgeAvailable: false })).label).toBe("8 of 10 checks passed");
  });

  /**
   * Property: the pass count equals the number of passed checks, and is out of 10.
   * **Validates: Requirements 6.1, 6.2**
   */
  it("property: equals the number of passed checks, out of 10", () => {
    const rule = fc.constantFrom(...RULES);
    fc.assert(
      fc.property(fc.uniqueArray(rule), fc.uniqueArray(rule), (failedRules, missingRules) => {
        const failed = Object.fromEntries(failedRules.map((r) => [r, []]));
        const list = checks(failed).filter((c) => !missingRules.includes(c.rule));
        const count = passCount(input({ checks: list }));
        const expected = list.filter((c) => c.passed).length;
        expect(count.passed).toBe(expected);
        expect(count.total).toBe(TOTAL_RULES);
        expect(TOTAL_RULES).toBe(10);
        expect(count.label).toBe(`${expected} of 10 checks passed`);
      }),
    );
  });
});

describe("ruleRows", () => {
  it("lists all 10 rules in order with plain names and results", () => {
    const rows = ruleRows(input({ checks: checks({ P2: ["l3", "l1"] }) }));
    expect(rows.map((r) => r.rule)).toEqual(RULES);
    expect(rows.every((r) => r.name === RULE_NAMES[r.rule] && r.name.length > 0)).toBe(true);
    const p2 = rows[1];
    expect(p2).toMatchObject({ passed: false, resultLabel: "Failed", reasons: ["P2 reason"] });
    expect(p2.lines).toEqual([
      { id: "l1", number: 1, label: "Line 1" },
      { id: "l3", number: 3, label: "Line 3" },
    ]);
    expect(rows[0]).toMatchObject({ passed: true, resultLabel: "Passed", lines: [], reasons: [] });
  });

  it("shows P9 and P10 as failed with the not-available reason when the judge was unavailable", () => {
    const all = checks().map((c) => (c.rule === "P9" || c.rule === "P10" ? { ...c, line_ids: ["l1", "l2", "l3"] } : c));
    const rows = ruleRows(input({ checks: all, judgeAvailable: false }));
    for (const row of rows.filter((r) => r.rule === "P9" || r.rule === "P10")) {
      expect(row).toMatchObject({
        passed: false,
        resultLabel: "Failed",
        lines: [],
        reasons: [JUDGE_UNAVAILABLE_REASON],
      });
    }
  });

  it("still shows which rules failed when blocked, with the failed key facts", () => {
    const blocked = checks({ P1: [] }).map((c) => (c.rule === "P1" ? { ...c, failed_fact_ids: ["k1"] } : c));
    const rows = ruleRows(input({ checks: blocked, lines: [], keyFacts: [PHONE] }));
    expect(rows[0]).toMatchObject({
      rule: "P1",
      resultLabel: "Failed",
      lines: [],
      failedFacts: [{ id: "k1", label: "Phone number", value: "0300 123 4567" }],
    });
  });
});

describe("lineMarkers", () => {
  it("names the failed rules on each affected line, in rule order", () => {
    const markers = lineMarkers(input({ checks: checks({ P5: ["l2"], P2: ["l2", "l3"], P10: ["l9"] }) }));
    expect(Object.fromEntries(markers)).toEqual({ l2: ["P2", "P5"], l3: ["P2"] });
  });

  it("puts no P9 or P10 marker on lines when the judge was unavailable", () => {
    const all = checks({ P9: ["l1", "l2", "l3"], P10: ["l1", "l2", "l3"] });
    expect(lineMarkers(input({ checks: all, judgeAvailable: false })).size).toBe(0);
  });
});

describe("factSummary", () => {
  const DATE: KeyFact = { ...PHONE, id: "k2", type: "date", value: "1 April 2026", normalised: "2026-04-01" };
  const ACTION: KeyFact = { ...PHONE, id: "k3", type: "action", value: "pay", normalised: "pay" };

  it("leads with every key fact matching, and names the kinds checked in a fixed order", () => {
    const summary = factSummary(input({ keyFacts: [ACTION, PHONE, DATE] }));
    expect(summary).toEqual({
      matched: true,
      label: "All 3 key facts match the letter",
      detail: "Checked: dates, phone numbers and instructions.",
    });
    expect(factSummary(input({ keyFacts: [PHONE] })).label).toBe("The 1 key fact matches the letter");
    expect(factSummary(input({ keyFacts: [] }))).toEqual({
      matched: true,
      label: "No dates, amounts or instructions to check",
      detail: "",
    });
  });

  it("says how many key facts don't match when P1 fails", () => {
    const failed = checks({ P1: [] }).map((c) => (c.rule === "P1" ? { ...c, failed_fact_ids: ["k1"] } : c));
    expect(factSummary(input({ checks: failed, keyFacts: [PHONE, DATE] }))).toMatchObject({
      matched: false,
      label: "1 of 2 key facts does not match the letter",
    });
    const noIds = checks({ P1: [] });
    expect(factSummary(input({ checks: noIds, keyFacts: [PHONE] })).label).toBe(
      "Some key facts do not match the letter",
    );
  });
});
