/**
 * Blocked state (task 27; R2.5, R9.3, R9.5): failed-fact list, where the block
 * came from, and export. All text here is invented, with no real personal data.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CheckResult, KeyFact, Line } from "@/src/checker-client/schemas";
import { NOTICE, RULES } from "@/src/pipeline/decide";
import type { ConversionResult } from "@/src/pipeline/types";
import { NOT_JUDGED_EXPORT_MESSAGE, blockSource, canExport, failedKeyFacts } from "@/src/ui/blocked-state";
import {
  type CheckResponseBody,
  EMPTY_HISTORY,
  applyCheckResponse,
  buildCheckRequest,
  canUndo,
  editProblem,
  recordEdit,
  undoEdit,
} from "@/src/ui/line-edit";
import { resultLayout } from "@/src/ui/result-layout";

const ORIGINAL = "Pay £45 by 14 March 2026. Call 0300 123 4567.";

const FACTS: KeyFact[] = [
  { id: "f1", type: "money", value: "£45", normalised: "45.00", start: 4, end: 7, sentence_id: "s1" },
  { id: "f2", type: "date", value: "14 March 2026", normalised: "2026-03-14", start: 11, end: 24, sentence_id: "s1" },
  { id: "f3", type: "phone", value: "0300 123 4567", normalised: "03001234567", start: 31, end: 44, sentence_id: "s2" },
];

const LINES: Line[] = [{ id: "L1", text: "You need to pay £45.", source_sentence_id: "s1", symbol_id: null }];

function checks(p1Failed: string[] | null): CheckResult[] {
  return RULES.map((rule) => ({
    rule,
    passed: rule !== "P1" || p1Failed === null,
    line_ids: [],
    failed_fact_ids: rule === "P1" && p1Failed !== null ? p1Failed : [],
    details: [],
  }));
}

function makeResult(overrides: Partial<ConversionResult> = {}): ConversionResult {
  return {
    status: "passed",
    original: {
      text: ORIGINAL,
      sentences: [
        { id: "s1", text: "Pay £45 by 14 March 2026.", start: 0, end: 25 },
        { id: "s2", text: "Call 0300 123 4567.", start: 26, end: 45 },
      ],
    },
    keyFacts: FACTS,
    lines: LINES,
    checks: checks(null),
    attempts: 1,
    notice: NOTICE,
    judgeAvailable: true,
    models: [],
    actionSynonyms: [],
    lineFacts: [],
    ...overrides,
  };
}

const blocked = (failed: string[], extra: Partial<ConversionResult> = {}) =>
  makeResult({ status: "blocked", lines: [], checks: checks(failed), ...extra });

describe("failedKeyFacts", () => {
  it("lists failed facts with type labels and Original values, in Original order", () => {
    expect(failedKeyFacts(blocked(["f3", "f1"]))).toEqual([
      { id: "f1", type: "money", typeLabel: "amount", value: "£45" },
      { id: "f3", type: "phone", typeLabel: "phone number", value: "0300 123 4567" },
    ]);
  });

  it("drops unknown IDs and is empty when P1 passed", () => {
    expect(failedKeyFacts(blocked(["nope", "f2"])).map((f) => f.id)).toEqual(["f2"]);
    expect(failedKeyFacts(makeResult())).toEqual([]);
  });
});

describe("blockSource and canExport", () => {
  it("is null and exportable when not blocked", () => {
    expect(blockSource(makeResult(), EMPTY_HISTORY)).toBeNull();
    expect(canExport(makeResult())).toBe(true);
    expect(canExport(null)).toBe(false);
  });

  it("is 'conversion' for a blocked conversion and 'edit' after a blocking edit", () => {
    const before = makeResult();
    const after = blocked(["f1"]);
    expect(blockSource(after, EMPTY_HISTORY)).toBe("conversion");
    expect(blockSource(after, recordEdit(EMPTY_HISTORY, before, after))).toBe("edit");
  });

  it("is 'conversion' when a new blocked result replaces an edited one", () => {
    const history = recordEdit(EMPTY_HISTORY, makeResult(), makeResult({ attempts: 2 }));
    expect(blockSource(blocked(["f1"]), history)).toBe("conversion");
  });

  it("refuses export when the judge gave no answer, because P10 never ran", () => {
    expect(canExport(makeResult({ judgeAvailable: false }))).toBe(false);
    expect(canExport(makeResult({ status: "flagged", judgeAvailable: false }))).toBe(false);
    expect(canExport(makeResult({ status: "flagged" }))).toBe(true);
    expect(NOT_JUDGED_EXPORT_MESSAGE).toBe("You cannot save this yet, because the advice check did not run.");
  });
});

describe("blocked-state properties", () => {
  const knownId = fc.constantFrom(...FACTS.map((f) => f.id));
  const unknownId = fc.string({ minLength: 1, maxLength: 6 }).filter((s) => !FACTS.some((f) => f.id === s));
  const ids = fc.array(fc.oneof(knownId, unknownId), { maxLength: 12 });

  it("blocked means no export and no lines rendered, even if lines arrive", () => {
    // **Validates: Requirements 2.5, 9.5**
    fc.assert(
      fc.property(ids, fc.boolean(), (failed, sendLines) => {
        const result = blocked(failed, { lines: sendLines ? LINES : [] });
        expect(canExport(result)).toBe(false);
        expect(resultLayout(result).rows).toEqual([]);
        expect(resultLayout(result).withheld).toBe(true);
      }),
    );
  });

  it("every known failed_fact_id appears exactly once, and unknown IDs are dropped", () => {
    // **Validates: Requirements 2.5, 9.3**
    fc.assert(
      fc.property(ids, (failed) => {
        const list = failedKeyFacts(blocked(failed)).map((f) => f.id);
        const known = new Set(failed.filter((id) => FACTS.some((f) => f.id === id)));
        expect(new Set(list).size).toBe(list.length);
        expect(new Set(list)).toEqual(known);
      }),
    );
  });
});

/**
 * The demo moment: change the date in a line, and the checked result comes
 * back blocked. The /api/check route turns a P1 failure into "blocked"
 * (check-route.test.ts); this covers what the screen does with it.
 */
describe("editing a line to change a date", () => {
  const DATED: Line[] = [{ id: "L1", text: "You need to pay £45 by 14 March 2026.", source_sentence_id: "s1", symbol_id: null }];

  it("blocks the output, names the date and offers Undo edit", () => {
    const before = makeResult({ lines: DATED });
    const draft = "You need to pay £45 by 15 March 2026.";
    expect(editProblem(before.lines, "L1", draft)).toBeNull();

    const request = buildCheckRequest(before, "L1", draft);
    expect(request.original).toBe(ORIGINAL);
    expect(request.lines[0].text).toBe(draft);
    expect(request.editedLineIds).toEqual(["L1"]);

    // What /api/check returns when P1 can't find 14 March 2026 unchanged.
    const response: CheckResponseBody = {
      status: "blocked",
      checks: checks(["f2"]),
      lines: [],
      lineFacts: [],
      sentences: before.original.sentences,
      keyFacts: FACTS,
      judgeAvailable: true,
      models: [],
    };
    const after = applyCheckResponse(before, response);
    const history = recordEdit(EMPTY_HISTORY, before, after);

    expect(after.lines).toEqual([]);
    expect(resultLayout(after).withheld).toBe(true);
    expect(resultLayout(after).rows).toEqual([]);
    expect(canExport(after)).toBe(false);
    expect(blockSource(after, history)).toBe("edit");
    expect(failedKeyFacts(after).map((f) => f.value)).toEqual(["14 March 2026"]);
    expect(after.original.text).toBe(ORIGINAL);

    expect(canUndo(history, after)).toBe(true);
    const undone = undoEdit(history, after);
    expect(undone?.result).toBe(before);
    expect(canExport(undone!.result)).toBe(true);
  });
});
