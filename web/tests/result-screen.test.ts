/**
 * Pure helpers behind the result screen (task 22): Original segments from
 * sentence spans, line-to-sentence mapping, row layout and blocked status.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CheckResult, Line, Sentence } from "@/src/checker-client/schemas";
import type { ConversionResult, Rule } from "@/src/pipeline/types";
import {
  originalSegments,
  resultLayout,
  scrollTopToReveal,
  sentenceIdForLine,
  symbolSrc,
} from "@/src/ui/result-layout";

const RULES: Rule[] = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"];

// Invented letter, no real personal data.
const ORIGINAL = "Dear tenant,\n\nWe will repair your boiler on 3 March 2026.  Call 0300 123 4567 if you can't be in.\n";

function sentence(id: string, text: string): Sentence {
  const start = ORIGINAL.indexOf(text);
  return { id, text, start, end: start + text.length };
}

const SENTENCES: Sentence[] = [
  sentence("s1", "Dear tenant,"),
  sentence("s2", "We will repair your boiler on 3 March 2026."),
  sentence("s3", "Call 0300 123 4567 if you can't be in."),
];

const LINES: Line[] = [
  { id: "l1", text: "The council will repair your boiler.", source_sentence_id: "s2", symbol_id: "2336" },
  { id: "l2", text: "The repair is on 3 March 2026.", source_sentence_id: "s2", symbol_id: null },
  { id: "l3", text: "The letter gives a phone number: 0300 123 4567.", source_sentence_id: "s3", symbol_id: null },
  { id: "l4", text: "A line from a sentence that isn't there.", source_sentence_id: "s9", symbol_id: null },
];

function checks(failed: Partial<Record<Rule, string[]>> = {}): CheckResult[] {
  return RULES.map((rule) => ({
    rule,
    passed: !(rule in failed),
    line_ids: failed[rule] ?? [],
    failed_fact_ids: [],
    details: [],
  }));
}

function result(overrides: Partial<ConversionResult> = {}): ConversionResult {
  return {
    status: "passed",
    original: { text: ORIGINAL, sentences: SENTENCES },
    keyFacts: [],
    lines: LINES,
    checks: checks(),
    attempts: 1,
    notice: "This is a simplified version. The original letter is the official one.",
    judgeAvailable: true,
    models: [],
    ...overrides,
  };
}

describe("originalSegments", () => {
  it("keeps the text between sentences, including line breaks and double spaces", () => {
    const segments = originalSegments(ORIGINAL, SENTENCES);
    expect(segments.map((s) => s.text).join("")).toBe(ORIGINAL);
    expect(segments.filter((s) => s.kind === "sentence").map((s) => s.text)).toEqual(SENTENCES.map((s) => s.text));
    expect(segments.map((s) => s.kind)).toEqual(["sentence", "text", "sentence", "text", "sentence", "text"]);
    expect(segments[1].text).toBe("\n\n");
    expect(segments[3].text).toBe("  ");
  });

  it("returns no segments for empty text", () => {
    expect(originalSegments("", [])).toEqual([]);
  });

  it("clamps out-of-range spans and trims overlaps", () => {
    const text = "One. Two.";
    const segments = originalSegments(text, [
      { id: "a", text: "", start: -3, end: 4 },
      { id: "b", text: "", start: 2, end: 99 },
    ]);
    expect(segments).toEqual([
      { kind: "sentence", start: 0, end: 4, text: "One.", sentenceId: "a" },
      { kind: "sentence", start: 4, end: 9, text: " Two.", sentenceId: "b" },
    ]);
  });

  /** Spans: any integers, including out of range, reversed, overlapping and duplicated. */
  const textAndSpans = fc.string({ maxLength: 80 }).chain((text) =>
    fc.tuple(
      fc.constant(text),
      fc.array(
        fc.record({
          id: fc.string({ minLength: 1, maxLength: 3 }),
          text: fc.constant(""),
          start: fc.integer({ min: -5, max: text.length + 5 }),
          end: fc.integer({ min: -5, max: text.length + 5 }),
        }),
        { maxLength: 8 },
      ),
    ),
  );

  it("property: segments cover the Original exactly and in order, for any spans", () => {
    fc.assert(
      fc.property(textAndSpans, ([text, spans]) => {
        const segments = originalSegments(text, spans);
        expect(segments.map((s) => s.text).join("")).toBe(text);
        let cursor = 0;
        for (const s of segments) {
          expect(s.start).toBe(cursor);
          expect(s.end).toBeGreaterThan(s.start);
          expect(s.text).toBe(text.slice(s.start, s.end));
          if (s.kind === "sentence") {
            // A sentence segment stays inside one of its own spans (clamped to the text).
            const clamp = (n: number) => Math.max(0, Math.min(n, text.length));
            const inside = spans.some(
              (p) => p.id === s.sentenceId && clamp(p.start) <= s.start && s.end === clamp(p.end),
            );
            expect(inside).toBe(true);
          }
          cursor = s.end;
        }
        expect(cursor).toBe(text.length);
      }),
    );
  });
});

describe("sentenceIdForLine", () => {
  it("maps a line to its source sentence", () => {
    expect(sentenceIdForLine("l1", LINES, SENTENCES)).toBe("s2");
    expect(sentenceIdForLine("l3", LINES, SENTENCES)).toBe("s3");
  });

  it("returns null for an unknown line or a missing source sentence", () => {
    expect(sentenceIdForLine("nope", LINES, SENTENCES)).toBeNull();
    expect(sentenceIdForLine("l4", LINES, SENTENCES)).toBeNull();
  });
});

describe("resultLayout", () => {
  it("builds one row per line, with a picture URL only when symbol_id is set", () => {
    const layout = resultLayout(result());
    expect(layout.withheld).toBe(false);
    expect(layout.rows.map((r) => [r.id, r.symbolSrc, r.sourceSentenceId])).toEqual([
      ["l1", "/symbols/2336", "s2"],
      ["l2", null, "s2"],
      ["l3", null, "s3"],
      ["l4", null, null],
    ]);
    expect(layout.rows.map((r) => r.text)).toEqual(LINES.map((l) => l.text));
  });

  it("marks lines named by a failed rule", () => {
    const layout = resultLayout(result({ status: "flagged", checks: checks({ P2: ["l2"], P10: ["l3"] }) }));
    expect(layout.rows.filter((r) => r.flagged).map((r) => r.id)).toEqual(["l2", "l3"]);
  });

  it("blocked status returns no lines but keeps the Original", () => {
    const layout = resultLayout(result({ status: "blocked", lines: LINES, checks: checks({ P1: [] }) }));
    expect(layout.withheld).toBe(true);
    expect(layout.rows).toEqual([]);
    expect(layout.segments.map((s) => s.text).join("")).toBe(ORIGINAL);
  });

  it("encodes symbol IDs in the URL", () => {
    expect(symbolSrc("a/b c")).toBe("/symbols/a%2Fb%20c");
  });
});

describe("scrollTopToReveal", () => {
  const container = { top: 100, height: 300, scrollTop: 50 };

  it("leaves the scroll alone when the sentence is already visible", () => {
    expect(scrollTopToReveal(container, { top: 150, height: 40 })).toBe(50);
  });

  it("scrolls down to a sentence below the box", () => {
    expect(scrollTopToReveal(container, { top: 600, height: 40 })).toBe(50 + 500 - 100);
  });

  it("scrolls up to a sentence above the box, never below 0", () => {
    expect(scrollTopToReveal(container, { top: 60, height: 20 })).toBe(0);
  });
});
