/**
 * Key-fact highlighting (task 25, R5.3): Original pieces, line pieces and colours.
 * All text here is invented, with no real personal data.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CheckResult, KeyFact, Line, LineFactSpan, Sentence } from "@/src/checker-client/schemas";
import type { ConversionResult, Rule } from "@/src/pipeline/types";
import {
  FACT_PALETTE,
  type FactSpan,
  factColours,
  factStyles,
  highlightPieces,
  highlightSegments,
  linePieces,
  pieceClassName,
} from "@/src/ui/key-fact-highlight";
import { originalSegments, resultLayout } from "@/src/ui/result-layout";

const RULES: Rule[] = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"];
const TYPES = ["date", "time", "money", "reference", "phone", "address", "action"] as const;

function fact(id: string, start: number, end: number, extra: Partial<KeyFact> = {}): KeyFact {
  return { id, type: "date", value: "", normalised: id, start, end, sentence_id: "s1", ...extra };
}

function checks(p1Failed: string[] = []): CheckResult[] {
  return RULES.map((rule) => ({
    rule,
    passed: rule !== "P1" || p1Failed.length === 0,
    line_ids: [],
    failed_fact_ids: rule === "P1" ? p1Failed : [],
    details: [],
  }));
}

function result(overrides: Partial<ConversionResult>): ConversionResult {
  return {
    status: "passed",
    original: { text: "", sentences: [] },
    keyFacts: [],
    lines: [],
    checks: checks(),
    attempts: 1,
    notice: "This is a simplified version. The original letter is the official one.",
    judgeAvailable: true,
    models: [],
    actionSynonyms: [],
    lineFacts: [],
    ...overrides,
  };
}

// --- generators ------------------------------------------------------------------

/** Text with line breaks and spaces, plus spans that may be out of range, empty, nested or overlapping. */
const textAndSpans = fc.string({ maxLength: 60, unit: fc.constantFrom("a", "b", " ", "\n", "£", "4", ".") }).chain((text) => {
  const offset = fc.integer({ min: -3, max: text.length + 3 });
  const span = fc.tuple(offset, offset).map(([a, b]) => ({ start: Math.min(a, b), end: Math.max(a, b) }));
  return fc.record({
    text: fc.constant(text),
    sentences: fc.array(span, { maxLength: 5 }),
    facts: fc.array(fc.tuple(span, fc.constantFrom(...TYPES), fc.constantFrom("x", "y", "z")), { maxLength: 6 }),
  });
});

function toSentences(spans: { start: number; end: number }[], text: string): Sentence[] {
  return spans.map((s, i) => ({ id: `s${i + 1}`, text: text.slice(s.start, s.end), start: s.start, end: s.end }));
}

function toFacts(raw: [{ start: number; end: number }, KeyFact["type"], string][]): KeyFact[] {
  return raw.map(([span, type, normalised], i) => fact(`k${i + 1}`, span.start, span.end, { type, normalised }));
}

// --- properties ------------------------------------------------------------------

describe("highlightSegments: properties", () => {
  it("pieces reproduce the Original exactly, for any sentence and fact spans", () => {
    /** **Validates: Requirements 5.3** */
    fc.assert(
      fc.property(textAndSpans, ({ text, sentences, facts }) => {
        const keyFacts = toFacts(facts);
        const segments = highlightSegments(text, originalSegments(text, toSentences(sentences, text)), keyFacts);
        const pieces = segments.flatMap((s) => s.pieces);
        expect(pieces.map((p) => p.text).join("")).toBe(text);
        // Each segment's pieces join back to the segment, with no empty piece.
        for (const segment of segments) expect(segment.pieces.map((p) => p.text).join("")).toBe(segment.text);
        let cursor = 0;
        for (const piece of pieces) {
          expect(piece.start).toBe(cursor);
          expect(piece.end).toBeGreaterThan(piece.start);
          expect(piece.text).toBe(text.slice(piece.start, piece.end));
          cursor = piece.end;
          // A piece lists exactly the facts whose span covers it.
          const covering = keyFacts.filter((f) => f.start <= piece.start && f.end >= piece.end && f.end > f.start);
          expect([...piece.factIds].sort()).toEqual([...new Set(covering.map((f) => f.id))].sort());
        }
      }),
    );
  });

  it("a fact outside every sentence still renders", () => {
    /** **Validates: Requirements 5.3** */
    fc.assert(
      fc.property(textAndSpans, ({ text, sentences, facts }) => {
        const keyFacts = toFacts(facts);
        const segments = highlightSegments(text, originalSegments(text, toSentences(sentences, text)), keyFacts);
        const shown = new Set(segments.flatMap((s) => s.pieces.flatMap((p) => p.factIds)));
        for (const f of keyFacts) {
          const start = Math.max(0, f.start);
          const end = Math.min(text.length, f.end);
          // Every fact with any text in range is highlighted, wherever it falls.
          if (end > start) expect(shown.has(f.id)).toBe(true);
        }
      }),
    );
  });

  it("the same fact gets the same colour in both columns", () => {
    /** **Validates: Requirements 5.3** */
    const scenario = fc
      .array(fc.tuple(fc.constantFrom(...TYPES), fc.constantFrom("a", "b", "c", "d", "e", "f", "g", "h", "i")), {
        minLength: 1,
        maxLength: 12,
      })
      .chain((raw) => {
        const text = raw.map((_, i) => `F${String(i).padStart(2, "0")} `).join("");
        const keyFacts = raw.map(([type, normalised], i) => fact(`k${i}`, i * 4, i * 4 + 3, { type, normalised }));
        const lineText = "abcdefghij".repeat(3);
        return fc.record({
          text: fc.constant(text),
          keyFacts: fc.constant(keyFacts),
          failed: fc.subarray(keyFacts.map((f) => f.id)),
          lineFacts: fc.array(
            fc.record({
              line_id: fc.constantFrom("L1", "L2"),
              fact_id: fc.constantFrom(...keyFacts.map((f) => f.id), "unknown"),
              start: fc.integer({ min: 0, max: 29 }),
              end: fc.integer({ min: 1, max: 30 }),
            }),
            { maxLength: 8 },
          ),
          lineText: fc.constant(lineText),
        });
      });
    fc.assert(
      fc.property(scenario, ({ text, keyFacts, failed, lineFacts, lineText }) => {
        const lines: Line[] = ["L1", "L2"].map((id) => ({ id, text: lineText, source_sentence_id: "s1", symbol_id: null }));
        const layout = resultLayout(
          result({ status: "flagged", original: { text, sentences: [] }, keyFacts, lines, lineFacts, checks: checks(failed) }),
        );
        const classByFact = new Map<string, string>();
        const record = (factId: string, className: string | null) => {
          expect(className).not.toBeNull();
          const seen = classByFact.get(factId);
          if (seen === undefined) classByFact.set(factId, className!);
          else expect(className).toBe(seen);
        };
        for (const p of layout.segments.flatMap((s) => s.pieces)) {
          if (p.factIds.length > 0) record(p.factIds.at(-1)!, pieceClassName(p, layout.factStyles));
        }
        for (const row of layout.rows) {
          expect(row.pieces.map((p) => p.text).join("")).toBe(row.text);
          for (const p of row.pieces) {
            if (p.factIds.length === 0) continue;
            // Spans for facts that aren't in the Original are never shown.
            expect(p.factIds.every((id) => layout.factStyles.has(id))).toBe(true);
            record(p.factIds.at(-1)!, pieceClassName(p, layout.factStyles));
          }
        }
        // Facts with the same type and value share a colour; others differ until the palette runs out.
        const colours = factColours(keyFacts);
        const keys = [...new Set(keyFacts.map((f) => `${f.type}/${f.normalised}`))];
        for (const a of keyFacts) {
          for (const b of keyFacts) {
            const same = a.type === b.type && a.normalised === b.normalised;
            if (same) expect(colours.get(a.id)).toBe(colours.get(b.id));
            else if (keys.length <= FACT_PALETTE.length) expect(colours.get(a.id)).not.toBe(colours.get(b.id));
          }
        }
      }),
    );
  });
});

// --- examples --------------------------------------------------------------------

describe("highlightPieces", () => {
  it("splits an action around the date inside it, with the date innermost", () => {
    const text = "Pay by 1 April 2026 please.";
    const spans: FactSpan[] = [
      { factId: "act", start: 0, end: 19 },
      { factId: "date", start: 7, end: 19 },
    ];
    expect(highlightPieces(text, 0, text.length, spans).map((p) => [p.text, p.factIds, p.endingFactIds])).toEqual([
      ["Pay by ", ["act"], []],
      ["1 April 2026", ["act", "date"], ["date", "act"]],
      [" please.", [], []],
    ]);
  });

  it("returns nothing for an empty range", () => {
    expect(highlightPieces("abc", 2, 2, [])).toEqual([]);
  });
});

describe("factColours", () => {
  it("cycles through the palette by first position in the Original", () => {
    const facts = Array.from({ length: FACT_PALETTE.length + 2 }, (_, i) => fact(`k${i}`, 100 - i, 101 - i));
    const colours = factColours(facts);
    // The last fact starts first, so it gets colour 0.
    expect(colours.get(`k${FACT_PALETTE.length + 1}`)).toBe(0);
    expect(colours.get("k0")).toBe((FACT_PALETTE.length + 1) % FACT_PALETTE.length);
  });
});

describe("resultLayout key facts", () => {
  // Invented letter, no real personal data.
  const ORIGINAL = "Ref AB123456\nYou must pay £45 by 1 April 2026.";
  const SENTENCES: Sentence[] = [{ id: "s1", text: "You must pay £45 by 1 April 2026.", start: 13, end: ORIGINAL.length }];
  const at = (value: string) => ORIGINAL.indexOf(value);
  const KEY_FACTS: KeyFact[] = [
    fact("k1", at("AB123456"), at("AB123456") + 8, { type: "reference", normalised: "AB123456" }),
    fact("k2", at("£45"), at("£45") + 3, { type: "money", normalised: "4500 GBP" }),
    fact("k3", at("1 April"), at("1 April") + 12, { type: "date", normalised: "2026-04-01" }),
  ];
  const LINE: Line = { id: "L1", text: "You must pay £45 by 1 April 2026.", source_sentence_id: "s1", symbol_id: null };
  const LINE_FACTS: LineFactSpan[] = [
    { line_id: "L1", fact_id: "k2", start: 13, end: 16 },
    { line_id: "L1", fact_id: "k3", start: 20, end: 32 },
  ];

  it("highlights the reference outside every sentence and the facts in the line", () => {
    const layout = resultLayout(
      result({ original: { text: ORIGINAL, sentences: SENTENCES }, keyFacts: KEY_FACTS, lines: [LINE], lineFacts: LINE_FACTS }),
    );
    const textSegment = layout.segments.find((s) => s.kind === "text")!;
    expect(textSegment.pieces.find((p) => p.factIds.includes("k1"))?.text).toBe("AB123456");
    expect(layout.rows[0].pieces.filter((p) => p.factIds.length).map((p) => p.text)).toEqual(["£45", "1 April 2026"]);
    expect(layout.factStyles.get("k2")?.label).toBe("amount");
  });

  it("keeps fact highlights in the Original when blocked, with failed facts marked", () => {
    const layout = resultLayout(
      result({
        status: "blocked",
        original: { text: ORIGINAL, sentences: SENTENCES },
        keyFacts: KEY_FACTS,
        lines: [LINE],
        lineFacts: LINE_FACTS,
        checks: checks(["k2"]),
      }),
    );
    expect(layout.rows).toEqual([]);
    const money = layout.segments.flatMap((s) => s.pieces).find((p) => p.factIds.includes("k2"))!;
    expect(money.text).toBe("£45");
    expect(pieceClassName(money, layout.factStyles)).toContain("ring-destructive");
    expect(layout.factStyles.get("k2")).toMatchObject({ failed: true, label: "amount, did not match" });
    expect(layout.factStyles.get("k3")?.failed).toBe(false);
  });

  it("ignores line spans for other lines and unknown facts", () => {
    const pieces = linePieces("L1", LINE.text, [...LINE_FACTS, { line_id: "L2", fact_id: "k2", start: 0, end: 3 }, { line_id: "L1", fact_id: "zz", start: 0, end: 3 }], new Set(["k2"]));
    expect(pieces.filter((p) => p.factIds.length).map((p) => [p.text, p.factIds])).toEqual([["£45", ["k2"]]]);
  });

  it("styles hold the type label, never the value", () => {
    const styles = factStyles(KEY_FACTS, []);
    for (const s of styles.values()) {
      for (const f of KEY_FACTS) expect(s.label).not.toContain(f.normalised);
    }
  });
});
