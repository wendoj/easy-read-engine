import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CheckerUnavailable } from "@/src/checker-client/errors";
import type { SymbolMatch } from "@/src/checker-client/schemas";
import { SYMBOL_MIN_SCORE, type WorkingLine, attachSymbols } from "@/src/pipeline";
import { ARASAAC_ATTRIBUTION, ARASAAC_ATTRIBUTION_PARTS } from "@/src/symbols/attribution";
import { SYMBOL_CACHE_CONTROL, arasaacImageUrl, handleSymbolImage, symbolCacheDir } from "@/src/symbols/image";

// Invented lines only. No letter text.

function line(id: string, symbolQuery: string): WorkingLine {
  return { id, text: `Line ${id}.`, source_sentence_id: "s1", symbol_id: null, symbolQuery };
}

/** A fake checker: a fixed top match per query, and a record of each request. */
function fakeChecker(table: Record<string, SymbolMatch | undefined>, opts: { failOn?: string } = {}) {
  const calls: { q: string; limit: number | undefined }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  return {
    calls,
    maxInFlight: () => maxInFlight,
    async symbols(q: string, limit?: number): Promise<SymbolMatch[]> {
      calls.push({ q, limit });
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      if (q === opts.failOn) throw new CheckerUnavailable("/symbols", "network");
      const top = table[q];
      return top ? [top] : [];
    },
  };
}

describe("attachSymbols", () => {
  it("takes the top match only above the threshold", async () => {
    const checker = fakeChecker({
      pay: { id: "9014", score: 1.75 },
      council: { id: "29873", score: 1.125 },
      edge: { id: "1", score: SYMBOL_MIN_SCORE },
    });
    const out = await attachSymbols([line("L1", "pay"), line("L2", "council"), line("L3", "edge"), line("L4", "xyz")], checker);
    expect(out.map((l) => l.symbol_id)).toEqual(["9014", null, null, null]);
    expect(checker.calls.every((c) => c.limit === 1)).toBe(true);
  });

  it("makes no request for an empty query and one request per distinct query", async () => {
    const checker = fakeChecker({ pay: { id: "9014", score: 1.75 } });
    const out = await attachSymbols([line("L1", " "), line("L2", "Pay"), line("L3", "pay "), line("L4", "")], checker);
    expect(out.map((l) => l.symbol_id)).toEqual([null, "9014", "9014", null]);
    expect(checker.calls.map((c) => c.q)).toEqual(["pay"]);
  });

  it("keeps every other field and replaces an old symbol ID", async () => {
    const old = { ...line("L1", "xyz"), symbol_id: "123" };
    const [out] = await attachSymbols([old], fakeChecker({}));
    expect(out).toEqual({ ...old, symbol_id: null });
  });

  it("propagates CheckerUnavailable", async () => {
    const checker = fakeChecker({}, { failOn: "b" });
    await expect(attachSymbols([line("L1", "a"), line("L2", "b"), line("L3", "c")], checker)).rejects.toBeInstanceOf(
      CheckerUnavailable,
    );
  });

  it("never has more requests in flight than the limit", async () => {
    const checker = fakeChecker({});
    const lines = Array.from({ length: 12 }, (_, i) => line(`L${i + 1}`, `q${i}`));
    await attachSymbols(lines, checker, { concurrency: 3 });
    expect(checker.calls).toHaveLength(12);
    expect(checker.maxInFlight()).toBeLessThanOrEqual(3);
  });

  it("property: a line has a symbol only when its query's top score is above the threshold", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ q: fc.constantFrom("", "a", "b", "c"), score: fc.double({ min: 0, max: 2, noNaN: true }) }), {
          maxLength: 8,
        }),
        async (rows) => {
          const table: Record<string, SymbolMatch> = {};
          for (const r of rows) table[r.q] ??= { id: `id-${r.q}`, score: r.score };
          const out = await attachSymbols(
            rows.map((r, i) => line(`L${i}`, r.q)),
            fakeChecker(table),
          );
          out.forEach((l, i) => {
            const top = table[rows[i].q];
            const expected = rows[i].q !== "" && top.score > SYMBOL_MIN_SCORE ? top.id : null;
            expect(l.symbol_id).toBe(expected);
          });
        },
      ),
      { numRuns: 50 },
    );
  });
});

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function fakeFetch(respond: (url: string) => Response) {
  const urls: string[] = [];
  return {
    urls,
    fetch: async (url: string) => {
      urls.push(url);
      return respond(url);
    },
  };
}

const pngResponse = () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });

describe("symbols route", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "symbol-cache-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.each(["", "abc", "12a", "../1", "1/2", "..", "1.png", " 1", "-1", "12345678901", "%2e%2e"])(
    "rejects the ID %j without fetching or touching the cache",
    async (id) => {
      const f = fakeFetch(pngResponse);
      const res = await handleSymbolImage(id, { cacheDir: dir, fetch: f.fetch });
      expect(res.status).toBe(400);
      expect(f.urls).toEqual([]);
      expect(await readdir(dir)).toEqual([]);
    },
  );

  it("fetches once from ARASAAC, then serves from the cache", async () => {
    const f = fakeFetch(pngResponse);
    const first = await handleSymbolImage("2239", { cacheDir: dir, fetch: f.fetch });
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("image/png");
    expect(first.headers.get("cache-control")).toBe(SYMBOL_CACHE_CONTROL);
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(PNG);
    expect(f.urls).toEqual([arasaacImageUrl("2239")]);
    expect(f.urls[0]).toBe("https://static.arasaac.org/pictograms/2239/2239_500.png");
    expect(await readdir(dir)).toEqual(["2239.png"]); // no temp file left
    expect(new Uint8Array(await readFile(path.join(dir, "2239.png")))).toEqual(PNG);

    const failing = fakeFetch(() => new Response(null, { status: 500 }));
    const second = await handleSymbolImage("2239", { cacheDir: dir, fetch: failing.fetch });
    expect(second.status).toBe(200);
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(PNG);
    expect(failing.urls).toEqual([]);
  });

  it("shares one fetch between parallel requests for the same ID", async () => {
    const f = fakeFetch(pngResponse);
    const res = await Promise.all([1, 2, 3].map(() => handleSymbolImage("2240", { cacheDir: dir, fetch: f.fetch })));
    expect(res.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(f.urls).toHaveLength(1);
  });

  it("returns 404 for an unknown pictogram and caches nothing", async () => {
    const f = fakeFetch(() => new Response("not found", { status: 404, headers: { "content-type": "text/html" } }));
    const res = await handleSymbolImage("99999999", { cacheDir: dir, fetch: f.fetch });
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await readdir(dir)).toEqual([]);
  });

  it("returns 502 when ARASAAC fails or sends something that isn't a PNG", async () => {
    const responses = [
      () => new Response(null, { status: 503 }),
      () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
      () => {
        throw new TypeError("fetch failed");
      },
    ];
    for (const respond of responses) {
      const res = await handleSymbolImage("2241", { cacheDir: dir, fetch: fakeFetch(respond).fetch });
      expect(res.status).toBe(502);
    }
    expect(await readdir(dir)).toEqual([]);
  });

  it("reads the cache directory from SYMBOL_CACHE_DIR", () => {
    expect(symbolCacheDir({ SYMBOL_CACHE_DIR: "/data/symbol-cache" })).toBe("/data/symbol-cache");
    expect(symbolCacheDir({})).toBe(path.resolve("symbol-cache"));
  });
});

describe("ARASAAC attribution", () => {
  it("matches the wording in checker/data/LICENSE-pictograms.md", async () => {
    const licence = await readFile(path.resolve(__dirname, "../../checker/data/LICENSE-pictograms.md"), "utf8");
    expect(licence).toContain(`**Attribution:** ${ARASAAC_ATTRIBUTION}`);
    expect(ARASAAC_ATTRIBUTION_PARTS.map((p) => p.text).join("")).toBe(ARASAAC_ATTRIBUTION);
  });
});
