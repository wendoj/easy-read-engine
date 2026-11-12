/**
 * Read-aloud neighbours: the glossary ("tap a word"), the "What you need to do"
 * checklist and the calendar file. All text here is invented.
 */
import fc from "fast-check";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { KeyFact, Line, LineFactSpan } from "@/src/checker-client/schemas";
import type { ConversionResult } from "@/src/pipeline/types";
import { buildIcs, escapeIcsText, foldIcsLine, nextDay } from "@/src/ui/calendar";
import { GLOSSARY, findGlossaryMatches, splitAtGlossary } from "@/src/ui/glossary";
import { resultLayout } from "@/src/ui/result-layout";
import { buildToDoItems, isTask, toDoCountLabel, validIsoDate } from "@/src/ui/to-do-list";

describe("glossary", () => {
  it("only uses pictures from the symbol index (P8)", () => {
    const index = JSON.parse(readFileSync(resolve(__dirname, "../../checker/data/symbols.json"), "utf8")) as {
      id: string;
    }[];
    const ids = new Set(index.map((s) => s.id));
    for (const entry of GLOSSARY) {
      if (entry.symbolId !== null) expect(ids.has(entry.symbolId), entry.term).toBe(true);
    }
  });

  it("keeps each meaning to one sentence of at most 15 words, with no digits to spell out", () => {
    for (const entry of GLOSSARY) {
      const words = entry.meaning.split(/\s+/).filter(Boolean);
      expect(words.length, entry.term).toBeLessThanOrEqual(15);
      expect(entry.meaning, entry.term).not.toMatch(/[!]|\b(simple|easy|just)\b/i);
      expect(entry.forms.length, entry.term).toBeGreaterThan(0);
    }
  });

  it("finds whole words, ignoring case, and not parts of other words", () => {
    const text = "The Summons says you owe an instalment. Instalments are small. Summonsed is not a match.";
    const found = findGlossaryMatches(text).map((m) => text.slice(m.start, m.end));
    expect(found).toEqual(["Summons", "instalment", "Instalments"]);
  });

  it("matches a phrase over extra spaces and prefers the longer phrase", () => {
    const text = "A liability  order is a court decision.";
    const found = findGlossaryMatches(text);
    expect(found).toHaveLength(1);
    expect(found[0].entry.term).toBe("liability order");
  });

  it("splits text into parts that join back to the text", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("pay", "the", "instalment", "summons", "direct debit", " ", ", ", "£45"), {
          maxLength: 12,
        }),
        (pieces) => {
          const text = pieces.join(" ");
          const parts = splitAtGlossary(text, findGlossaryMatches(text));
          expect(parts.map((p) => p.text).join("")).toBe(text);
          expect(parts.every((p) => p.text.length > 0)).toBe(true);
        },
      ),
    );
  });
});

// --- checklist ---------------------------------------------------------------------

function fact(id: string, type: KeyFact["type"], normalised: string): KeyFact {
  return { id, type, value: normalised, normalised, start: 0, end: 1, sentence_id: "s1" };
}

function span(line_id: string, fact_id: string, start = 0, end = 1): LineFactSpan {
  return { line_id, fact_id, start, end };
}

function build(
  lines: Line[],
  keyFacts: KeyFact[],
  lineFacts: LineFactSpan[],
  status: ConversionResult["status"] = "passed",
): ConversionResult {
  return {
    status,
    original: { text: "", sentences: [] },
    keyFacts,
    lines,
    checks: [],
    attempts: 1,
    notice: "This is a simplified version.",
    judgeAvailable: true,
    models: [],
    actionSynonyms: [],
    lineFacts,
  };
}

const line = (id: string, text: string): Line => ({ id, text, source_sentence_id: "s1", symbol_id: null });

describe("What you need to do", () => {
  const lines = [
    line("l1", "The council wrote to you."),
    line("l2", "Pay £45 by 14 March 2026."),
    line("l3", "Call 0300 123 4567 if you can't pay."),
    line("l4", "Pay by 14 March or 15 March 2026."),
    line("l5", "Send the form by 1 March."),
  ];
  const keyFacts = [
    fact("a1", "action", "pay"),
    fact("d1", "date", "2026-03-14"),
    fact("a2", "action", "call"),
    fact("p1", "phone", "03001234567"),
    fact("a3", "action", "pay by 14 march or 15 march"),
    fact("d2", "date", "2026-03-14"),
    fact("d3", "date", "2026-03-15"),
    fact("a4", "action", "send"),
    fact("d4", "date", "--03-01"),
  ];
  const lineFacts = [
    span("l2", "a1"),
    span("l2", "d1"),
    span("l3", "a2"),
    span("l3", "p1"),
    span("l4", "a3"),
    span("l4", "d2"),
    span("l4", "d3"),
    span("l5", "a4"),
    span("l5", "d4"),
  ];

  it("lists only lines with a required action, in line order, and no conditional ones", () => {
    const result = build(lines, keyFacts, lineFacts);
    const items = buildToDoItems(result, resultLayout(result).rows);
    expect(items.map((i) => i.row.id)).toEqual(["l2", "l4", "l5"]);
  });

  it("leaves out repeats, keeping the fuller line in the earlier place", () => {
    const repeated = [
      line("l1", "Call 0161 234 5002."),
      line("l2", "Pay £45 by 14 March 2026."),
      line("l3", "Call 0161 234 5002."),
      line("l4", "Call 0161 234 5002, 9am to 6pm."),
    ];
    const facts = [
      fact("a1", "action", "call 0161 234 5002"),
      fact("a2", "action", "pay £45"),
      fact("a3", "action", "call 0161 234 5002 9am"),
    ];
    const spans = [span("l1", "a1"), span("l2", "a2"), span("l3", "a1"), span("l4", "a3")];
    const result = build(repeated, facts, spans);
    expect(buildToDoItems(result, resultLayout(result).rows).map((i) => i.row.id)).toEqual(["l4", "l2"]);
  });

  it("gives a deadline only for exactly 1 full date in the line", () => {
    const result = build(lines, keyFacts, lineFacts);
    const items = buildToDoItems(result, resultLayout(result).rows);
    expect(items.map((i) => i.deadline)).toEqual(["2026-03-14", null, null]);
  });

  it("lists nothing when blocked or when no line holds an action", () => {
    const blocked = build([], keyFacts, lineFacts, "blocked");
    expect(buildToDoItems(blocked, resultLayout(blocked).rows)).toEqual([]);
    const none = build(lines, keyFacts, [span("l2", "d1")]);
    expect(buildToDoItems(none, resultLayout(none).rows)).toEqual([]);
  });

  it("accepts only real calendar dates", () => {
    expect(validIsoDate("2026-02-28")).toBe("2026-02-28");
    expect(validIsoDate("2026-02-30")).toBeNull();
    expect(validIsoDate("--03-01")).toBeNull();
    expect(validIsoDate("2026-03")).toBeNull();
  });
});

// --- calendar ----------------------------------------------------------------------

describe("calendar file", () => {
  it("ends an all-day event on the next day, across month and year ends", () => {
    expect(nextDay("2026-03-14")).toBe("20260315");
    expect(nextDay("2026-02-28")).toBe("20260301");
    expect(nextDay("2026-12-31")).toBe("20270101");
    expect(nextDay("2028-02-28")).toBe("20280229");
  });

  it("escapes text values", () => {
    expect(escapeIcsText("a, b; c\\d\ne")).toBe("a\\, b\\; c\\\\d\\ne");
  });

  it("folds long lines at 75 bytes without splitting a character, and unfolds to the original", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300, unit: "grapheme" }), (text) => {
        const folded = foldIcsLine(`SUMMARY:${text}`);
        for (const part of folded) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
        const unfolded = folded.map((p, i) => (i === 0 ? p : p.slice(1))).join("");
        expect(unfolded).toBe(`SUMMARY:${text}`);
      }),
    );
  });

  it("builds a valid all-day event with the notice", () => {
    const ics = buildIcs({
      title: "Pay £45 by 14 March 2026.",
      date: "2026-03-14",
      notice: "This is a simplified version. The original letter is the official one.",
      uid: "abc@easy-read",
      now: new Date("2026-01-02T03:04:05.678Z"),
    });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTAMP:20260102T030405Z\r\n");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260314\r\n");
    expect(ics).toContain("DTEND;VALUE=DATE:20260315\r\n");
    expect(ics).toContain("SUMMARY:Pay £45 by 14 March 2026.\r\n");
    // Long lines are folded (CRLF and a space), so read the file unfolded.
    expect(ics.replace(/\r\n /g, "")).toContain("The original letter is the official one.");
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });
});

describe("toDoCountLabel", () => {
  it("says thing for 1 and things otherwise", () => {
    expect(toDoCountLabel(1)).toBe("1 thing to do");
    expect(toDoCountLabel(4)).toBe("4 things to do");
  });
});

describe("isTask", () => {
  it.each([
    ["Please ignore this.", "Thank you, please ignore this."],
    ["Choose the 7th, 15th, 21st or 28th of the month.", "You can pick a payment date that suits you."],
    ["Why not pay by Direct Debit.", "Why not pay by Direct Debit?"],
    ["Need help with council tax.", "Need help with council tax?"],
    ["Please tell us.", "If you think your bill is wrong, please tell us."],
    ["Then please tell us.", "If you think your bill is wrong, please tell us."],
    ["So you don't have to pay the whole bill.", "Act now so you don't have to pay the whole bill."],
    ["Call us if you can't pay.", "Call us if you can't pay."],
    ["Or call 0300 123 4567.", "Pay online or call 0300 123 4567."],
    ["Check your account.", "• Check your account"],
    ["Help yourself online.", "Help yourself online:"],
  ])("leaves out %s", (lineText, source) => {
    expect(isTask(lineText, source)).toBe(false);
  });

  it.each([
    ["You need to pay £181.62 by 15 July.", "You need to pay £181.62 by 15 July if possible."],
    ["Please pay online now if you can.", "Please pay online now if you can."],
    ["Pay full amount.", "Pay full\namount"],
    ["Contact us now.", "Contact us now."],
    ["You must send the form.", "• You must send the form by 1 May."],
  ])("keeps %s", (lineText, source) => {
    expect(isTask(lineText, source)).toBe(true);
  });
});
