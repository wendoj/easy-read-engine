/**
 * Pure helpers behind the input screen (task 21): NDJSON stream parsing,
 * convert event validation and progress, the word limit, and error messages.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CONVERT_ERRORS } from "@/src/convert/errors";
import { MAX_CHARACTERS, MAX_WORDS, TOO_MANY_CHARACTERS_MESSAGE, tooLongMessage } from "@/src/convert/word-count";
import { EXTRACT_ERRORS } from "@/src/extract/errors";
import type { ConversionResult, ProgressEvent } from "@/src/pipeline/types";
import { convertLetter } from "@/src/ui/api";
import {
  BUSY_FALLBACK,
  GENERIC_MESSAGE,
  RATE_LIMITED_FALLBACK,
  TOO_LONG_FALLBACK,
  errorMessage,
} from "@/src/ui/api-errors";
import { parseConvertEvent, progressLabel, progressValue, stageRows } from "@/src/ui/convert-events";
import { NdjsonParseError, NdjsonParser, readNdjson } from "@/src/ui/ndjson";
import { wordLimitState } from "@/src/ui/word-limit";

const encoder = new TextEncoder();

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

/** Splits bytes at the given cut points (sorted, deduplicated). */
function splitAt(bytes: Uint8Array, cuts: number[]): Uint8Array[] {
  const points = [...new Set(cuts.map((c) => c % (bytes.length + 1)))].sort((a, b) => a - b);
  const chunks: Uint8Array[] = [];
  let start = 0;
  for (const p of points) {
    chunks.push(bytes.slice(start, p));
    start = p;
  }
  chunks.push(bytes.slice(start));
  return chunks;
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const v of readNdjson(stream)) out.push(v);
  return out;
}

const result: ConversionResult = {
  status: "passed",
  original: { text: "You owe £45.", sentences: [{ id: "s1", text: "You owe £45.", start: 0, end: 12 }] },
  keyFacts: [],
  lines: [{ id: "l1", text: "You need to pay £45.", source_sentence_id: "s1", symbol_id: null }],
  checks: [],
  attempts: 1,
  notice: "This is a simplified version. The original letter is the official one.",
  judgeAvailable: true,
  models: [],
  actionSynonyms: [],
  lineFacts: [],
};

describe("NdjsonParser", () => {
  it("keeps a line split across chunks until it is complete", () => {
    const parser = new NdjsonParser();
    expect(parser.push('{"a":1}\n{"b"')).toEqual([{ a: 1 }]);
    expect(parser.push(":2}\n")).toEqual([{ b: 2 }]);
    expect(parser.end()).toEqual([]);
  });

  it("reads a last line with no newline, and skips blank and CRLF lines", () => {
    const parser = new NdjsonParser();
    expect(parser.push('{"a":1}\r\n\n')).toEqual([{ a: 1 }]);
    expect(parser.push('{"b":2}')).toEqual([]);
    expect(parser.end()).toEqual([{ b: 2 }]);
  });

  it("throws without quoting the bad line", () => {
    const parser = new NdjsonParser();
    expect(() => parser.push("You owe £45\n")).toThrow(NdjsonParseError);
    try {
      new NdjsonParser().push("You owe £45\n");
    } catch (err) {
      expect((err as Error).message).not.toContain("45");
    }
  });
});

describe("readNdjson", () => {
  it("decodes a multi-byte character split between chunks", async () => {
    const bytes = encoder.encode('{"text":"£45"}\n');
    const pound = bytes.indexOf(0xc2);
    const values = await collect(streamOf([bytes.slice(0, pound + 1), bytes.slice(pound + 1)]));
    expect(values).toEqual([{ text: "£45" }]);
  });

  it("yields the same values however the bytes are chunked", async () => {
    const value = fc.oneof(
      fc.record({ type: fc.constant("progress"), attempt: fc.integer({ min: 1, max: 3 }) }),
      fc.record({ text: fc.string({ unit: "grapheme" }) }),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(value, { maxLength: 6 }), fc.array(fc.nat(), { maxLength: 8 }), async (values, cuts) => {
        const bytes = encoder.encode(values.map((v) => `${JSON.stringify(v)}\n`).join(""));
        expect(await collect(streamOf(splitAt(bytes, cuts)))).toEqual(values);
      }),
      { numRuns: 100 },
    );
  });
});

describe("convert events", () => {
  it("accepts progress, result and error events and rejects other shapes", () => {
    const progress = { type: "progress", stage: "checking", attempt: 2, maxAttempts: 3 };
    expect(parseConvertEvent(progress)).toEqual(progress);
    expect(parseConvertEvent({ type: "result", result })).toEqual({ type: "result", result });
    const error = { type: "error", error: "checker_unavailable", status: 503, message: "Down." };
    expect(parseConvertEvent(error)).toEqual(error);
    expect(parseConvertEvent({ type: "progress", stage: "dancing", attempt: 1, maxAttempts: 3 })).toBeNull();
    expect(parseConvertEvent({ type: "result", result: { status: "passed" } })).toBeNull();
    expect(parseConvertEvent("hello")).toBeNull();
  });

  it("labels stages in plain words with the try number", () => {
    expect(progressLabel({ type: "progress", stage: "analysing", attempt: 1, maxAttempts: 3 })).toBe("Reading the letter");
    expect(progressLabel({ type: "progress", stage: "checking", attempt: 2, maxAttempts: 3 })).toBe(
      "Checking the Easy Read version, try 2 of 3",
    );
  });

  it("moves the bar forward through the stages and stays below 100", () => {
    const order = [
      { stage: "analysing", attempt: 1 },
      { stage: "rewriting", attempt: 1 },
      { stage: "checking", attempt: 1 },
      { stage: "regenerating", attempt: 2 },
      { stage: "checking", attempt: 2 },
      { stage: "regenerating", attempt: 3 },
      { stage: "checking", attempt: 3 },
    ] as const;
    const values = order.map((e) => progressValue({ type: "progress", maxAttempts: 3, ...e }));
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
    expect(values.at(-1)).toBeLessThan(100);
    expect(values[0]).toBeGreaterThan(0);
  });
});

describe("wordLimitState", () => {
  it("allows a letter at the limit and blocks one word over", () => {
    const atLimit = wordLimitState(Array(MAX_WORDS).fill("word").join(" "));
    expect(atLimit).toMatchObject({ words: MAX_WORDS, canConvert: true, overLimit: false, message: null });
    expect(atLimit.label).toBe("1,500 of 1,500 words");

    const over = wordLimitState(Array(MAX_WORDS + 1).fill("word").join(" "));
    expect(over).toMatchObject({ canConvert: false, overLimit: true, message: tooLongMessage(MAX_WORDS + 1) });
  });

  it("blocks empty text without an over-limit message", () => {
    expect(wordLimitState("  \n ")).toMatchObject({ words: 0, canConvert: false, overLimit: false, message: null });
  });

  it("blocks text over the character limit", () => {
    const state = wordLimitState("a".repeat(MAX_CHARACTERS + 1));
    expect(state).toMatchObject({ canConvert: false, overLimit: true, message: TOO_MANY_CHARACTERS_MESSAGE });
  });
});

describe("errorMessage", () => {
  it("shows the R1.4 message for handwriting and the table message for other extract codes", () => {
    expect(errorMessage("extract", 422, { error: "handwriting", message: "x" })).toBe(EXTRACT_ERRORS.handwriting.message);
    for (const [code, { status, message }] of Object.entries(EXTRACT_ERRORS)) {
      expect(errorMessage("extract", status, { error: code })).toBe(message);
    }
  });

  it("uses the table for fixed convert codes", () => {
    for (const [code, { status, message }] of Object.entries(CONVERT_ERRORS)) {
      expect(errorMessage("convert", status, { error: code, message: "other" })).toBe(message);
    }
  });

  it("shows the server message for codes that hold numbers, with a fallback", () => {
    expect(errorMessage("convert", 400, { error: "too_long", message: tooLongMessage(1600) })).toBe(tooLongMessage(1600));
    expect(errorMessage("convert", 400, { error: "too_long" })).toBe(TOO_LONG_FALLBACK);
    const wait = "Too many requests. Try again in 5 minutes.";
    expect(errorMessage("extract", 429, { error: "rate_limited", message: wait })).toBe(wait);
    expect(errorMessage("convert", 429, { error: "rate_limited" })).toBe(RATE_LIMITED_FALLBACK);
    expect(errorMessage("convert", 503, { error: "daily_limit", message: "Daily limit reached, try again tomorrow" })).toBe(
      "Daily limit reached, try again tomorrow",
    );
  });

  it("falls back on the status when the body isn't ours", () => {
    expect(errorMessage("convert", 503, null)).toBe(BUSY_FALLBACK);
    expect(errorMessage("convert", 429, "<html>")).toBe(RATE_LIMITED_FALLBACK);
    expect(errorMessage("extract", 413, null)).toBe(EXTRACT_ERRORS.too_large.message);
    expect(errorMessage("convert", 500, { error: "toString" })).toBe(GENERIC_MESSAGE);
  });
});

describe("convertLetter", () => {
  function fetchReturning(response: Response, seen: { body?: unknown }): typeof fetch {
    return (async (_url: RequestInfo | URL, init?: RequestInit) => {
      seen.body = JSON.parse(String(init?.body));
      return response;
    }) as typeof fetch;
  }

  it("sends the confirmed text unchanged and reports progress before the result", async () => {
    const lines = [
      { type: "progress", stage: "analysing", attempt: 1, maxAttempts: 3 },
      { type: "progress", stage: "checking", attempt: 1, maxAttempts: 3 },
      { type: "result", result },
    ];
    const bytes = encoder.encode(lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
    const seen: { body?: unknown } = {};
    const progress: string[] = [];
    const original = "  You owe £45.\n";
    const outcome = await convertLetter(original, {
      fetch: fetchReturning(new Response(streamOf(splitAt(bytes, [7, 40, 90]))), seen),
      onProgress: (e) => progress.push(e.stage),
    });
    expect(seen.body).toEqual({ original });
    expect(progress).toEqual(["analysing", "checking"]);
    expect(outcome).toEqual({ ok: true, result });
  });

  it("returns the message from an error event or a non-200 response", async () => {
    const event = { type: "error", error: "checker_unavailable", status: 503, message: "x" };
    const streamed = await convertLetter("text", {
      fetch: fetchReturning(new Response(streamOf([encoder.encode(`${JSON.stringify(event)}\n`)])), {}),
    });
    expect(streamed).toEqual({ ok: false, error: "checker_unavailable", message: CONVERT_ERRORS.checker_unavailable.message });

    const rejected = await convertLetter("text", {
      fetch: fetchReturning(Response.json({ error: "too_long", message: tooLongMessage(1501) }, { status: 400 }), {}),
    });
    expect(rejected).toEqual({ ok: false, error: "too_long", message: tooLongMessage(1501) });
  });
});

describe("stageRows", () => {
  const ev = (stage: ProgressEvent["stage"], attempt = 1) =>
    ({ type: "progress", stage, attempt, maxAttempts: 3 }) as ProgressEvent;
  const states = (rows: ReturnType<typeof stageRows>) => rows.map((r) => `${r.id}:${r.state}`);

  it("starts with Read current before any event, and no Fix row", () => {
    expect(states(stageRows(null, false))).toEqual(["read:current", "write:pending", "check:pending"]);
  });

  it("marks earlier stages done and later ones pending", () => {
    expect(states(stageRows(ev("checking"), false))).toEqual(["read:done", "write:done", "check:current"]);
  });

  it("adds the Fix row on the first regenerating event, with a try tag", () => {
    const rows = stageRows(ev("regenerating", 2), false);
    expect(states(rows)).toEqual(["read:done", "write:done", "check:done", "fix:current"]);
    expect(rows[3].tag).toBe("Try 2 of 3");
  });

  it("keeps Fix as done when Check runs again, and tags the current Check", () => {
    const rows = stageRows(ev("checking", 2), true);
    expect(states(rows)).toEqual(["read:done", "write:done", "check:current", "fix:done"]);
    expect(rows[2].tag).toBe("Try 2 of 3");
    expect(rows[3].tag).toBeNull();
  });

  it("property: never more than 4 rows and exactly 1 current row", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("analysing", "rewriting", "checking", "regenerating" as const),
        fc.integer({ min: 1, max: 3 }),
        fc.boolean(),
        (stage, attempt, sawFix) => {
          const rows = stageRows(ev(stage as ProgressEvent["stage"], attempt), sawFix);
          expect(rows.length).toBeLessThanOrEqual(4);
          expect(rows.filter((r) => r.state === "current")).toHaveLength(1);
        },
      ),
    );
  });
});
