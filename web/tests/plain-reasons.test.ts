import { describe, expect, it } from "vitest";
import { plainReason, reasonsByLine } from "@/src/ui/plain-reasons";
import { NO_REASON_TEXT, ruleRows } from "@/src/ui/rule-report";

const IDS = new Set(["L1", "L2", "L36"]);

describe("plainReason", () => {
  it("names the hard word, with no line ID in the text", () => {
    expect(plainReason("P5", "L36 has 1 words that are not common and not explained: arrears", IDS)).toEqual({
      lineId: "L36",
      text: "A hard word is not explained: arrears.",
    });
  });

  it("counts more than one in plain words", () => {
    expect(plainReason("P7", "L1 has 2 abbreviations that are not explained: DD, PIP", IDS).text).toBe(
      "2 short forms are not explained: DD, PIP.",
    );
    expect(plainReason("P6", "L1 has 1 numbers written in words", IDS).text).toBe("A number is written in words.");
  });

  it("rewords rule language", () => {
    expect(plainReason("P4", "L2 uses the passive voice", IDS).text).toBe("It does not say who does the action.");
    expect(plainReason("P2", "L1 has a sentence of 18 words (limit 15)", IDS).text).toBe(
      "A sentence has 18 words. The most is 15.",
    );
    expect(plainReason("P9", "L1 meaning: Says council instead of we.", IDS).text).toBe(
      "The meaning may have changed: Says council instead of we.",
    );
  });

  it("keeps an unknown detail, and leaves an ID that isn't a line on screen", () => {
    expect(plainReason("P8", "L9 has no picture", IDS)).toEqual({ lineId: null, text: "L9 has no picture." });
  });
});

describe("reasonsByLine", () => {
  it("collects reasons per line from failed rules only", () => {
    const byLine = reasonsByLine(
      [
        { rule: "P4", passed: false, details: ["L1 uses the passive voice"] },
        { rule: "P5", passed: false, details: ["L1 has 1 words that are not common and not explained: arrears"] },
        { rule: "P2", passed: true, details: ["L2 has a sentence of 18 words (limit 15)"] },
      ],
      IDS,
    );
    expect(byLine.get("L1")).toEqual(["It does not say who does the action.", "A hard word is not explained: arrears."]);
    expect(byLine.has("L2")).toBe(false);
  });
});

describe("ruleRows items", () => {
  it("links each reason to the line number on screen, not the line ID", () => {
    const lines = [
      { id: "L36", text: "a", source_sentence_id: "s1", symbol_id: null },
      { id: "L1", text: "b", source_sentence_id: "s1", symbol_id: null },
    ];
    const rows = ruleRows({
      checks: [{ rule: "P4", passed: false, line_ids: ["L1", "L36"], failed_fact_ids: [], details: ["L1 uses the passive voice"] }],
      lines,
      keyFacts: [],
      judgeAvailable: true,
    });
    const p4 = rows.find((r) => r.rule === "P4")!;
    expect(p4.items).toEqual([
      { line: { id: "L36", number: 1, label: "Line 1" }, text: NO_REASON_TEXT },
      { line: { id: "L1", number: 2, label: "Line 2" }, text: "It does not say who does the action." },
    ]);
  });
});

describe("pointLabel", () => {
  it("names dates, time limits and ranges, and leaves out a bare year", async () => {
    const { pointLabel } = await import("@/app/result/main-points");
    expect(pointLabel({ type: "date", normalised: "2023-07-08" })).toBe("Date");
    expect(pointLabel({ type: "date", normalised: "--07-15" })).toBe("Date");
    expect(pointLabel({ type: "date", normalised: "7 days" })).toBe("Time limit");
    expect(pointLabel({ type: "date", normalised: "mon to fri" })).toBe("When");
    expect(pointLabel({ type: "date", normalised: "1990" })).toBeNull();
    expect(pointLabel({ type: "money", normalised: "GBP 7500" })).toBe("Amount");
    expect(pointLabel({ type: "phone", normalised: "01842756577" })).toBeNull();
  });
});
