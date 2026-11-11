import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  type CheckRequest,
  type FetchFn,
  CheckerConfigError,
  CheckerRequestError,
  CheckerUnavailable,
  createCheckerClient,
} from "@/src/checker-client";

const BASE = "http://checker.test:8000";

interface Call {
  url: string;
  init: RequestInit;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Fake fetch that records calls and answers with `respond`. */
function fakeFetch(respond: (call: Call) => Response | Promise<Response>): { fetch: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      const call = { url, init };
      calls.push(call);
      return respond(call);
    },
  };
}

/** Fake fetch that never answers until the signal aborts, as real fetch does. */
const hangingFetch: FetchFn = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

const KEY_FACT = {
  id: "kf1",
  type: "money" as const,
  value: "£45",
  normalised: "4500 GBP",
  start: 12,
  end: 15,
  sentence_id: "s1",
};
const LINE = { id: "l1", text: "You need to pay £45.", source_sentence_id: "s1", symbol_id: null };
const CHECK_RESULT = { rule: "P1" as const, passed: true, line_ids: ["l1"], failed_fact_ids: [], details: [] };
const HEALTH = { status: "ok" as const, spacy_loaded: true, spacy_model: "en_core_web_sm", symbol_index_loaded: true };

describe("createCheckerClient config", () => {
  it("reads CHECKER_URL and strips a trailing slash", async () => {
    const prev = process.env.CHECKER_URL;
    process.env.CHECKER_URL = `${BASE}/`;
    try {
      const f = fakeFetch(() => json(200, HEALTH));
      await createCheckerClient({ fetch: f.fetch }).health();
      expect(f.calls[0].url).toBe(`${BASE}/health`);
    } finally {
      if (prev === undefined) delete process.env.CHECKER_URL;
      else process.env.CHECKER_URL = prev;
    }
  });

  it("rejects a missing or non-http base URL", () => {
    expect(() => createCheckerClient({ baseUrl: "" })).toThrow(CheckerConfigError);
    expect(() => createCheckerClient({ baseUrl: "not a url" })).toThrow(CheckerConfigError);
    expect(() => createCheckerClient({ baseUrl: "file:///tmp" })).toThrow(CheckerConfigError);
  });
});

describe("routes", () => {
  it("analyse posts the original to /analyse", async () => {
    const analysis = { sentences: [{ id: "s1", text: "Pay £45.", start: 0, end: 8 }], key_facts: [KEY_FACT] };
    const f = fakeFetch(() => json(200, analysis));
    const out = await createCheckerClient({ baseUrl: BASE, fetch: f.fetch }).analyse("Pay £45.");
    expect(out).toEqual(analysis);
    expect(f.calls[0].url).toBe(`${BASE}/analyse`);
    expect(f.calls[0].init.method).toBe("POST");
    expect(JSON.parse(f.calls[0].init.body as string)).toEqual({ original: "Pay £45." });
    expect(f.calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("keyFacts posts text to /key-facts", async () => {
    const f = fakeFetch(() => json(200, [KEY_FACT]));
    const out = await createCheckerClient({ baseUrl: BASE, fetch: f.fetch }).keyFacts("Pay £45.");
    expect(out).toEqual([KEY_FACT]);
    expect(f.calls[0].url).toBe(`${BASE}/key-facts`);
    expect(f.calls[0].init.method).toBe("POST");
    expect(JSON.parse(f.calls[0].init.body as string)).toEqual({ text: "Pay £45." });
  });

  it("check posts original, key facts and lines to /check", async () => {
    const req: CheckRequest = { original: "Pay £45.", key_facts: [KEY_FACT], lines: [LINE] };
    const f = fakeFetch(() => json(200, [CHECK_RESULT]));
    const out = await createCheckerClient({ baseUrl: BASE, fetch: f.fetch }).check(req);
    expect(out).toEqual([CHECK_RESULT]);
    expect(f.calls[0].url).toBe(`${BASE}/check`);
    expect(f.calls[0].init.method).toBe("POST");
    expect(JSON.parse(f.calls[0].init.body as string)).toEqual(req);
  });

  it("symbols gets /symbols with an encoded query and limit", async () => {
    const f = fakeFetch(() => json(200, [{ id: "2349", score: 3.5 }]));
    const client = createCheckerClient({ baseUrl: BASE, fetch: f.fetch });
    const out = await client.symbols("pay & bill", 3);
    expect(out).toEqual([{ id: "2349", score: 3.5 }]);
    const url = new URL(f.calls[0].url);
    expect(url.origin + url.pathname).toBe(`${BASE}/symbols`);
    expect(url.searchParams.get("q")).toBe("pay & bill");
    expect(url.searchParams.get("limit")).toBe("3");
    expect(f.calls[0].init.method).toBe("GET");
    expect(f.calls[0].init.body).toBeUndefined();

    await client.symbols("pay");
    expect(new URL(f.calls[1].url).searchParams.has("limit")).toBe(false);
  });

  it("health gets /health", async () => {
    const f = fakeFetch(() => json(200, HEALTH));
    expect(await createCheckerClient({ baseUrl: BASE, fetch: f.fetch }).health()).toEqual(HEALTH);
    expect(f.calls[0].url).toBe(`${BASE}/health`);
    expect(f.calls[0].init.method).toBe("GET");
  });

  it("actionSynonyms gets /config/action-synonyms", async () => {
    const table = [{ word: "contact", counts_as: "phone" }];
    const f = fakeFetch(() => json(200, table));
    expect(await createCheckerClient({ baseUrl: BASE, fetch: f.fetch }).actionSynonyms()).toEqual(table);
    expect(f.calls[0].url).toBe(`${BASE}/config/action-synonyms`);
    expect(f.calls[0].init.method).toBe("GET");
  });

  it("lineFacts posts key facts and lines to /line-facts", async () => {
    const spans = [{ line_id: "L1", fact_id: "k1", start: 13, end: 16 }];
    const f = fakeFetch(() => json(200, spans));
    const req = {
      key_facts: [],
      lines: [{ id: "L1", text: "You must pay £45.", source_sentence_id: "s1", symbol_id: null }],
    };
    expect(await createCheckerClient({ baseUrl: BASE, fetch: f.fetch }).lineFacts(req)).toEqual(spans);
    expect(f.calls[0].url).toBe(`${BASE}/line-facts`);
    expect(f.calls[0].init.method).toBe("POST");
    expect(JSON.parse(f.calls[0].init.body as string)).toEqual(req);
  });
});

describe("failures", () => {
  it("timeout gives CheckerUnavailable", async () => {
    const client = createCheckerClient({ baseUrl: BASE, fetch: hangingFetch, timeoutMs: 20 });
    const err = await client.analyse("text").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CheckerUnavailable);
    expect((err as CheckerUnavailable).reason).toBe("timeout");
  });

  it("network error gives CheckerUnavailable", async () => {
    const f = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    const err = await createCheckerClient({ baseUrl: BASE, fetch: f.fetch }).keyFacts("text").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CheckerUnavailable);
    expect((err as CheckerUnavailable).reason).toBe("network");
  });

  it("5xx gives CheckerUnavailable, including /health while starting", async () => {
    const f = fakeFetch(() => json(500, { detail: "internal error" }));
    const err = await createCheckerClient({ baseUrl: BASE, fetch: f.fetch }).check({ original: "x", key_facts: [], lines: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CheckerUnavailable);
    expect((err as CheckerUnavailable).status).toBe(500);

    const h = fakeFetch(() => json(503, { ...HEALTH, status: "starting", spacy_loaded: false }));
    await expect(createCheckerClient({ baseUrl: BASE, fetch: h.fetch }).health()).rejects.toBeInstanceOf(CheckerUnavailable);
  });

  it("4xx gives CheckerRequestError with locations and types only", async () => {
    const f = fakeFetch(() => json(422, { detail: [{ loc: ["body", "lines", 0, "text"], type: "missing" }] }));
    const err = await createCheckerClient({ baseUrl: BASE, fetch: f.fetch }).check({ original: "x", key_facts: [], lines: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CheckerRequestError);
    expect((err as CheckerRequestError).status).toBe(422);
    expect((err as CheckerRequestError).issues).toEqual([{ loc: ["body", "lines", 0, "text"], type: "missing" }]);

    const big = fakeFetch(() => json(413, { detail: "request body too large" }));
    const err413 = await createCheckerClient({ baseUrl: BASE, fetch: big.fetch }).analyse("x").catch((e: unknown) => e);
    expect(err413).toBeInstanceOf(CheckerRequestError);
    expect((err413 as CheckerRequestError).issues).toEqual([]);
  });

  it("a response that doesn't match the schema gives CheckerUnavailable", async () => {
    const f = fakeFetch(() => json(200, [{ id: 7 }]));
    const err = await createCheckerClient({ baseUrl: BASE, fetch: f.fetch }).symbols("pay").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CheckerUnavailable);
    expect((err as CheckerUnavailable).reason).toBe("invalid_response");
  });
});

// Every way a call can fail. Each mode may echo the input back, as a careless
// server or a network library could, to show the client never passes it on.
type Mode = "network" | "timeout" | "5xx" | "4xx" | "invalid" | "non-json";

function failingFetch(mode: Mode, text: string): FetchFn {
  return async (url, init) => {
    switch (mode) {
      case "network":
        throw new TypeError(`fetch failed for ${url} ${text}`);
      case "timeout":
        return hangingFetch(url, init);
      case "5xx":
        return json(500, { detail: text });
      case "4xx":
        // loc and type are fixed field names; the echoed text sits in fields the client must drop.
        return json(422, { detail: [{ loc: ["body", "original"], type: "string_too_long", input: text, msg: text }] });
      case "invalid":
        return json(200, { sentences: text, key_facts: [{ value: text }] });
      case "non-json":
        return new Response(text, { status: 502 });
    }
  };
}

describe("property: errors never contain the input text", () => {
  /**
   * For any input text and any failure mode on any route, the thrown error's
   * message (and its stack and own fields) never contains the text (R7.4).
   * **Validates: Requirements 3.1**
   */
  it("holds for every route and failure mode", async () => {
    // Texts long enough that they can't appear by chance in fixed message words.
    const text = fc.string({ minLength: 12, maxLength: 80 }).filter((s) => s.trim().length >= 12);
    const mode = fc.constantFrom<Mode>("network", "timeout", "5xx", "4xx", "invalid", "non-json");
    const route = fc.constantFrom("analyse", "keyFacts", "check", "symbols");

    await fc.assert(
      fc.asyncProperty(text, mode, route, async (t, m, r) => {
        const client = createCheckerClient({ baseUrl: BASE, fetch: failingFetch(m, t), timeoutMs: 5 });
        const call =
          r === "analyse"
            ? client.analyse(t)
            : r === "keyFacts"
              ? client.keyFacts(t)
              : r === "check"
                ? client.check({ original: t, key_facts: [{ ...KEY_FACT, value: t }], lines: [{ ...LINE, text: t }] })
                : client.symbols(t);
        const err = await call.then(
          () => {
            throw new Error("expected the call to fail");
          },
          (e: unknown) => e,
        );
        expect(err instanceof CheckerUnavailable || err instanceof CheckerRequestError).toBe(true);
        const e = err as Error;
        const encoded = encodeURIComponent(t);
        for (const s of [e.message, e.stack ?? "", JSON.stringify(e)]) {
          expect(s.includes(t)).toBe(false);
          expect(s.includes(encoded)).toBe(false);
        }
        expect(e.cause).toBeUndefined();
      }),
      { numRuns: 200 },
    );
  });
});
