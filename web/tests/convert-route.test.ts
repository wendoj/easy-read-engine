/**
 * `/api/convert` and the shared rate limits (task 17; R1.6, R1.7, R3.1, R7.4).
 * The checker and model are fakes, so no request leaves the machine.
 * Assertions on letter text use `includes`, so a failure never prints it.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CheckerUnavailable } from "@/src/checker-client/errors";
import type { CheckResult } from "@/src/checker-client/schemas";
import {
  type ConvertChecker,
  type ConvertEvent,
  type ConvertLogEvent,
  MAX_WORDS,
  countWords,
  handleConvert,
} from "@/src/convert";
import { handleExtract } from "@/src/extract";
import { ProviderChainError } from "@/src/llm/client";
import type { PipelineLogEvent, PipelineModel } from "@/src/pipeline";
import {
  DAILY_LIMIT_MESSAGE,
  type LimitedRoute,
  ROUTE_COSTS,
  clientKey,
  createRateLimiter,
  maskClientKey,
} from "@/src/rate-limit";

// ---------- fakes ----------

const MARKER = "Zebrafinch";
const LETTER = `Dear ${MARKER}, we have received your form. Please call us on 0300 123 4567.`;

function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
}

const pass = (rule: CheckResult["rule"]): CheckResult => ({
  rule,
  passed: true,
  line_ids: [],
  failed_fact_ids: [],
  details: [],
});

interface Calls {
  health: number;
  analyse: number;
  check: number;
  rewrite: number;
  regenerate: number;
  judge: number;
  getModel: number;
}

function newCalls(): Calls {
  return { health: 0, analyse: 0, check: 0, rewrite: 0, regenerate: 0, judge: 0, getModel: 0 };
}

function fakeChecker(calls: Calls, opts: { down?: boolean } = {}): ConvertChecker {
  return {
    async health() {
      calls.health += 1;
      if (opts.down) throw new CheckerUnavailable("/health", "network");
      return { status: "ok" };
    },
    async analyse(original) {
      calls.analyse += 1;
      return { sentences: [{ id: "s1", text: original, start: 0, end: original.length }], key_facts: [] };
    },
    async check() {
      calls.check += 1;
      return (["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"] as const).map(pass);
    },
  };
}

function fakeModel(calls: Calls, opts: { rewriteFailures?: number; retryAfterMs?: number } = {}): PipelineModel {
  let failures = opts.rewriteFailures ?? 0;
  return {
    async rewrite() {
      calls.rewrite += 1;
      if (failures > 0) {
        failures -= 1;
        throw new ProviderChainError("rewrite", [], opts.retryAfterMs);
      }
      return {
        lines: [{ text: `${MARKER} got your form.`, sourceSentenceId: "s1", symbolQuery: "" }],
        provider: "fake",
        model: "rewrite-model",
        requests: 1,
      };
    },
    async regenerate() {
      calls.regenerate += 1;
      throw new Error("regenerate should not be called when every rule passes");
    },
    async judge() {
      calls.judge += 1;
      return { checks: [pass("P9"), pass("P10")], available: true, provider: "fake", model: "judge-model", requests: 1 };
    },
  };
}

function convertRequest(body: unknown, ip = "203.0.113.7"): Request {
  return new Request("http://localhost/api/convert", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function setup(
  opts: { down?: boolean; rewriteFailures?: number; retryAfterMs?: number; limiter?: ReturnType<typeof createRateLimiter> } = {},
) {
  const calls = newCalls();
  const logs: unknown[] = [];
  const sleeps: number[] = [];
  const limiter = opts.limiter ?? createRateLimiter({ logger: (e) => logs.push(e) });
  const deps = {
    getChecker: () => fakeChecker(calls, opts),
    getModel: () => {
      calls.getModel += 1;
      return fakeModel(calls, opts);
    },
    rateLimit: limiter.limit,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    logger: (e: ConvertLogEvent) => logs.push(e),
    pipelineLogger: (e: PipelineLogEvent) => logs.push(e),
  };
  return { calls, logs, sleeps, deps, limiter };
}

async function readEvents(res: Response): Promise<ConvertEvent[]> {
  const text = await res.text();
  expect(text.endsWith("\n")).toBe(true);
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ConvertEvent);
}

function modelCalls(c: Calls): number {
  return c.getModel + c.rewrite + c.regenerate + c.judge;
}

// ---------- request validation ----------

describe("/api/convert request checks", () => {
  it("rejects a letter over 1,500 words with a 400 before any checker or model call", async () => {
    const { calls, deps, limiter } = setup();
    const res = await handleConvert(convertRequest({ original: words(MAX_WORDS + 1) }), deps);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("too_long");
    expect(body.message.includes("1,500")).toBe(true);
    expect(body.message.includes("1,501")).toBe(true);
    expect(modelCalls(calls)).toBe(0);
    expect(calls.health).toBe(0);
    expect(limiter.usedToday()).toBe(0);
  });

  it("accepts exactly 1,500 words", async () => {
    const { deps } = setup();
    const res = await handleConvert(convertRequest({ original: words(MAX_WORDS) }), deps);
    expect(res.status).toBe(200);
    const events = await readEvents(res);
    expect(events.at(-1)?.type).toBe("result");
  });

  it.each([
    ["not JSON", "{original:"],
    ["no original field", { text: "hello" }],
    ["original is not a string", { original: 42 }],
    ["a JSON array", [LETTER]],
  ])("rejects a body that is %s with a 400", async (_name, body) => {
    const { calls, deps } = setup();
    const res = await handleConvert(convertRequest(body), deps);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_request");
    expect(modelCalls(calls)).toBe(0);
  });

  it("rejects empty text with a 400", async () => {
    const { calls, deps } = setup();
    const res = await handleConvert(convertRequest({ original: "  \n " }), deps);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("empty");
    expect(modelCalls(calls)).toBe(0);
  });

  it("rejects a body over the size limit with a 413", async () => {
    const { calls, deps } = setup();
    const res = await handleConvert(convertRequest({ original: "a".repeat(200_000) }), deps);
    expect(res.status).toBe(413);
    expect(modelCalls(calls)).toBe(0);
  });
});

describe("countWords", () => {
  it("counts runs of characters between whitespace", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords("Pay £45 by 1 April 2026.")).toBe(6);
    expect(countWords(" one\ttwo\n\nthree\u00a0four ")).toBe(4);
  });
});

// ---------- streaming ----------

describe("/api/convert stream", () => {
  it("streams progress events, then the final ConversionResult", async () => {
    const { calls, deps } = setup();
    const res = await handleConvert(convertRequest({ original: LETTER }), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    expect(res.headers.get("cache-control")?.includes("no-store")).toBe(true);

    const events = await readEvents(res);
    const last = events.at(-1);
    const progress = events.slice(0, -1);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.every((e) => e.type === "progress")).toBe(true);
    expect(progress.map((e) => (e.type === "progress" ? e.stage : null))).toEqual(["analysing", "rewriting", "checking"]);
    expect(last?.type).toBe("result");
    if (last?.type !== "result") return;
    expect(last.result.status).toBe("passed");
    expect(last.result.original.text === LETTER).toBe(true);
    expect(last.result.lines).toHaveLength(1);
    expect(last.result.checks).toHaveLength(10);
    expect(calls.rewrite).toBe(1);
  });

  it("never logs the letter, lines or client address", async () => {
    const { deps, logs } = setup();
    const res = await handleConvert(convertRequest({ original: LETTER }), deps);
    await readEvents(res);
    const all = JSON.stringify(logs);
    expect(logs.length).toBeGreaterThan(0);
    expect(all.includes(MARKER)).toBe(false);
    expect(all.includes("0300")).toBe(false);
    expect(all.includes("203.0.113.7")).toBe(false);
  });
});

// ---------- 503s ----------

describe("/api/convert when a service is down", () => {
  it("returns 503 when the checker is down, with no model call", async () => {
    const { calls, deps, limiter } = setup({ down: true });
    const res = await handleConvert(convertRequest({ original: LETTER }), deps);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("checker_unavailable");
    expect(modelCalls(calls)).toBe(0);
    expect(limiter.usedToday()).toBe(0);
  });

  it("waits once for the shortest Retry-After, then ends with a 503 error event when every provider fails", async () => {
    const { calls, deps, sleeps } = setup({ rewriteFailures: 5, retryAfterMs: 2_500 });
    const res = await handleConvert(convertRequest({ original: LETTER }), deps);
    const events = await readEvents(res);
    const last = events.at(-1);
    expect(last).toEqual({
      type: "error",
      error: "providers_unavailable",
      status: 503,
      message: expect.any(String),
      retryAfterSeconds: 3,
    });
    expect(events.some((e) => e.type === "result")).toBe(false);
    expect(JSON.stringify(last).includes(MARKER)).toBe(false);
    expect(sleeps).toEqual([2_500]);
    expect(calls.rewrite).toBe(2);
    expect(calls.check).toBe(0);
  });

  it("gives up at once when no provider sent Retry-After", async () => {
    const { calls, deps, sleeps } = setup({ rewriteFailures: 1 });
    const events = await readEvents(await handleConvert(convertRequest({ original: LETTER }), deps));
    expect(events.at(-1)).toMatchObject({ type: "error", error: "providers_unavailable", status: 503 });
    expect(sleeps).toEqual([]);
    expect(calls.rewrite).toBe(1);
  });

  it("finishes the conversion when the call after the wait succeeds", async () => {
    const { deps, sleeps } = setup({ rewriteFailures: 1, retryAfterMs: 1_000 });
    const events = await readEvents(await handleConvert(convertRequest({ original: LETTER }), deps));
    expect(events.at(-1)?.type).toBe("result");
    expect(sleeps).toEqual([1_000]);
  });
});

// ---------- rate limits ----------

function limitRequest(ip: string): Request {
  return new Request("http://localhost/api/x", { method: "POST", headers: { "x-forwarded-for": ip } });
}

describe("shared rate limits", () => {
  it("returns 429 with Retry-After when one client's bucket is empty, shared across routes", async () => {
    let clock = Date.UTC(2026, 2, 1, 12);
    const limiter = createRateLimiter({ capacity: 7, refillPerHour: 7, dailyCap: 1000, now: () => clock, logger: () => {} });
    const { deps } = setup({ limiter });

    // 1 conversion (6 units) and 1 upload (1 unit) use the whole bucket.
    expect((await handleConvert(convertRequest({ original: LETTER }), deps)).status).toBe(200);
    const upload = new Request("http://localhost/api/extract", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.7" },
      body: new FormData(),
    });
    expect((await handleExtract(upload, { getClient: () => { throw new Error("unused"); }, rateLimit: limiter.limit })).status).toBe(400);

    const limited = await handleConvert(convertRequest({ original: LETTER }), deps);
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toBe("rate_limited");
    const retryAfter = Number(limited.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);

    // `/api/check` draws on the same bucket.
    expect(await limiter.limit(limitRequest("203.0.113.7"), "check")).toMatchObject({ allowed: false, status: 429 });
    // Another client isn't affected.
    expect((await handleConvert(convertRequest({ original: LETTER }, "198.51.100.9"), deps)).status).toBe(200);
    // After Retry-After the bucket has refilled enough.
    clock += retryAfter * 1000;
    expect((await handleConvert(convertRequest({ original: LETTER }), deps)).status).toBe(200);
  });

  it("returns 503 with the daily-limit message once the global cap is used, then resets the next UTC day", async () => {
    let clock = Date.UTC(2026, 2, 1, 23, 0);
    const limiter = createRateLimiter({ capacity: 100, refillPerHour: 100, dailyCap: 7, now: () => clock, logger: () => {} });
    const { deps, calls } = setup({ limiter });

    expect((await handleConvert(convertRequest({ original: LETTER }, "203.0.113.1"), deps)).status).toBe(200);
    expect(await limiter.limit(limitRequest("203.0.113.2"), "extract")).toEqual({ allowed: true });
    const rewritesBefore = calls.rewrite;

    const capped = await handleConvert(convertRequest({ original: LETTER }, "203.0.113.3"), deps);
    expect(capped.status).toBe(503);
    expect(await capped.json()).toEqual({ error: "daily_limit", message: DAILY_LIMIT_MESSAGE });
    expect(Number(capped.headers.get("retry-after"))).toBe(3600);
    expect(calls.rewrite).toBe(rewritesBefore);
    expect(await limiter.limit(limitRequest("203.0.113.4"), "check")).toMatchObject({ allowed: false, status: 503 });

    clock = Date.UTC(2026, 2, 2, 0, 0, 1);
    expect((await handleConvert(convertRequest({ original: LETTER }, "203.0.113.3"), deps)).status).toBe(200);
  });

  it("doesn't charge a rejected request against either limit", async () => {
    const limiter = createRateLimiter({ capacity: 6, refillPerHour: 1, dailyCap: 1000, logger: () => {} });
    const { deps } = setup({ limiter });
    await handleConvert(convertRequest({ original: words(MAX_WORDS + 1) }), deps);
    await handleConvert(convertRequest("{bad"), deps);
    expect(limiter.usedToday()).toBe(0);
    expect((await handleConvert(convertRequest({ original: LETTER }), deps)).status).toBe(200);
  });

  it("logs a masked client only", async () => {
    const events: unknown[] = [];
    const limiter = createRateLimiter({ capacity: 1, refillPerHour: 1, dailyCap: 1000, costs: { convert: 1, extract: 1, check: 1 }, logger: (e) => events.push(e) });
    await limiter.limit(limitRequest("203.0.113.77"), "check");
    await limiter.limit(limitRequest("203.0.113.77"), "check");
    expect(events).toEqual([{ msg: "rate_limit", route: "check", code: "rate_limited", client: "203.0.113.x" }]);
  });
});

describe("clientKey", () => {
  const key = (h: Record<string, string>) => clientKey(new Headers(h));

  it("takes the address the proxy appended, not ones the client sent", () => {
    expect(key({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" })).toBe("203.0.113.7");
    expect(key({ "x-forwarded-for": "203.0.113.7" })).toBe("203.0.113.7");
    expect(clientKey(new Headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.7, 10.0.0.2" }), 2)).toBe("203.0.113.7");
  });

  it("falls back to X-Real-Ip, then to one shared key", () => {
    expect(key({ "x-real-ip": "198.51.100.9" })).toBe("198.51.100.9");
    expect(key({ "x-forwarded-for": "not-an-ip" })).toBe("unknown");
    expect(key({})).toBe("unknown");
  });

  it("keys IPv6 clients by /64 and IPv4-mapped addresses as IPv4", () => {
    expect(key({ "x-forwarded-for": "2001:db8:1:2:aaaa::1" })).toBe("2001:db8:1:2::/64");
    expect(key({ "x-forwarded-for": "2001:db8:1:2:bbbb::9" })).toBe("2001:db8:1:2::/64");
    expect(key({ "x-forwarded-for": "::ffff:203.0.113.7" })).toBe("203.0.113.7");
    expect(key({ "x-forwarded-for": "[2001:db8::1]:443" })).toBe("2001:db8:0:0::/64");
  });

  it("masks keys for logs", () => {
    expect(maskClientKey("203.0.113.7")).toBe("203.0.113.x");
    expect(maskClientKey("2001:db8:1:2::/64")).toBe("2001:db8:1::/48");
    expect(maskClientKey("unknown")).toBe("unknown");
  });
});

// ---------- property ----------

describe("token bucket property", () => {
  /**
   * In any time window, one client is allowed at most the bucket capacity plus
   * the refill earned over the window.
   * **Validates: Requirements 1.7, 3.1** (design "Protecting the live quota")
   */
  it("never allows more than capacity plus refill in any window", async () => {
    const routes: LimitedRoute[] = ["convert", "extract", "check"];
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 6, max: 40 }),
        fc.integer({ min: 1, max: 120 }),
        fc.array(fc.tuple(fc.constantFrom(...routes), fc.integer({ min: 0, max: 15 * 60_000 })), { minLength: 1, maxLength: 60 }),
        async (capacity, refillPerHour, ops) => {
          let clock = Date.UTC(2026, 0, 1);
          const limiter = createRateLimiter({ capacity, refillPerHour, dailyCap: 1_000_000, now: () => clock, logger: () => {} });
          const allowed: { t: number; cost: number }[] = [];
          for (const [route, dt] of ops) {
            clock += dt;
            const d = await limiter.limit(limitRequest("203.0.113.7"), route);
            if (d.allowed) allowed.push({ t: clock, cost: ROUTE_COSTS[route] });
          }
          const perMs = refillPerHour / 3_600_000;
          for (let i = 0; i < allowed.length; i++) {
            let sum = 0;
            for (let j = i; j < allowed.length; j++) {
              sum += allowed[j].cost;
              expect(sum).toBeLessThanOrEqual(capacity + perMs * (allowed[j].t - allowed[i].t) + 1e-9);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
