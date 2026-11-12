/**
 * Judge access key (`/api/access`, `src/access`). The model routes' own
 * access tests are in convert-route.test.ts, extract.test.ts and
 * check-route.test.ts. The key is never asserted with `toContain` or
 * `toEqual` on logs, so a failure never prints it.
 */
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACCESS_COOKIE,
  ACCESS_ERRORS,
  type AccessLogEvent,
  accessState,
  accessToken,
  checkAccess,
  handleAccessDelete,
  handleAccessGet,
  handleAccessPost,
  keyMatches,
  readCookie,
} from "@/src/access";
import { createRateLimiter } from "@/src/rate-limit";
import { DAILY_CAP_EXEMPT, ROUTE_COSTS } from "@/src/rate-limit";
import { errorMessage } from "@/src/ui/api-errors";

const KEY = "Xq7-judge-key-for-tests";
const PROD = { ACCESS_KEY: KEY, APP_ENV: "production" };
const DEV = { ACCESS_KEY: KEY, APP_ENV: "development" };

function request(opts: { cookie?: string; method?: string; body?: unknown; ip?: string } = {}): Request {
  const headers: Record<string, string> = { "x-forwarded-for": opts.ip ?? "203.0.113.7" };
  if (opts.cookie !== undefined) headers.cookie = opts.cookie;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new Request("http://localhost/api/access", {
    method: opts.method ?? "GET",
    headers,
    ...(opts.body !== undefined ? { body: typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body) } : {}),
  });
}

function setup(env: Record<string, string | undefined>, capacity = 30) {
  const logs: AccessLogEvent[] = [];
  const limiter = createRateLimiter({
    capacity,
    refillPerHour: 1,
    dailyCap: 1000,
    costs: { ...ROUTE_COSTS, convert: 1, export: 1 },
    logger: () => {},
  });
  return { logs, limiter, deps: { env, rateLimit: limiter.limit, logger: (e: AccessLogEvent) => logs.push(e) } };
}

afterEach(() => vi.restoreAllMocks());

describe("access token", () => {
  it("is an HMAC of the key, never the key, and matches only its own key", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 200 }), fc.string({ minLength: 1, maxLength: 200 }), (a, b) => {
        const token = accessToken(a);
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
        expect(token === a).toBe(false);
        expect(token === accessToken(a)).toBe(true);
        if (a !== b) expect(token === accessToken(b)).toBe(false);
      }),
    );
  });

  it("round trips through the cookie header", () => {
    const req = request({ cookie: `other=1; ${ACCESS_COOKIE}=${accessToken(KEY)}; theme=dark` });
    expect(readCookie(req.headers.get("cookie"), ACCESS_COOKIE)).toBe(accessToken(KEY));
    expect(accessState(req, PROD)).toBe("granted");
  });

  it("rejects a cookie made with an old key, so changing ACCESS_KEY revokes every cookie", () => {
    const old = request({ cookie: `${ACCESS_COOKIE}=${accessToken("old-key")}` });
    expect(accessState(old, PROD)).toBe("denied");
    expect(checkAccess(old, PROD)).toEqual({ error: "access_required", ...ACCESS_ERRORS.access_required });
  });

  it("is open in development with no key, and closed in production with no key", () => {
    expect(accessState(request(), { APP_ENV: "development" })).toBe("open");
    expect(accessState(request(), { APP_ENV: "development", ACCESS_KEY: "  " })).toBe("open");
    expect(accessState(request(), { APP_ENV: "production" })).toBe("closed");
    expect(accessState(request(), { APP_ENV: "staging" })).toBe("closed");
    expect(checkAccess(request(), { APP_ENV: "production" })).toEqual({ error: "access_closed", ...ACCESS_ERRORS.access_closed });
    expect(checkAccess(request(), { APP_ENV: "development" })).toBeNull();
    expect(accessState(request(), DEV)).toBe("denied");
  });

  it("fails closed when APP_ENV is unset, unless NODE_ENV says next dev or Vitest", () => {
    // next dev and Vitest: open with no key, so local runs need no key.
    expect(accessState(request(), { NODE_ENV: "development" })).toBe("open");
    expect(accessState(request(), { NODE_ENV: "test" })).toBe("open");
    // next start, a container without APP_ENV, or nothing set: closed.
    expect(accessState(request(), { NODE_ENV: "production" })).toBe("closed");
    expect(accessState(request(), {})).toBe("closed");
    expect(accessState(request(), { APP_ENV: "  ", NODE_ENV: "production" })).toBe("closed");
    // APP_ENV wins when it is set.
    expect(accessState(request(), { APP_ENV: "production", NODE_ENV: "development" })).toBe("closed");
    expect(accessState(request(), { APP_ENV: "development", NODE_ENV: "production" })).toBe("open");
  });

  it("compares submitted keys exactly", () => {
    expect(keyMatches(KEY, PROD)).toBe(true);
    expect(keyMatches(`${KEY} `, PROD)).toBe(false);
    expect(keyMatches(KEY.toLowerCase(), PROD)).toBe(false);
    expect(keyMatches(KEY, { APP_ENV: "production" })).toBe(false);
  });
});

describe("POST /api/access", () => {
  it("sets an HttpOnly, SameSite=Strict, Secure cookie holding the HMAC in production", async () => {
    const { deps } = setup(PROD);
    const res = await handleAccessPost(request({ method: "POST", body: { key: KEY } }), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ access: "granted" });
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie.startsWith(`${ACCESS_COOKIE}=${accessToken(KEY)};`)).toBe(true);
    expect(cookie.includes(KEY)).toBe(false);
    for (const part of ["HttpOnly", "SameSite=Strict", "Path=/", "Max-Age=2592000", "Secure"]) {
      expect(cookie.split("; ")).toContain(part);
    }
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("leaves Secure off in development, so http://localhost works", async () => {
    const { deps } = setup(DEV);
    const res = await handleAccessPost(request({ method: "POST", body: { key: KEY } }), deps);
    expect(res.status).toBe(200);
    expect((res.headers.get("set-cookie") ?? "").split("; ")).not.toContain("Secure");
  });

  it("returns 401 for a wrong key and sets no cookie", async () => {
    const { deps } = setup(PROD);
    const res = await handleAccessPost(request({ method: "POST", body: { key: "wrong" } }), deps);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "wrong_key", message: "That access key is not right." });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("returns 400 for a missing, empty or too long key", async () => {
    const { deps } = setup(PROD);
    for (const body of [{}, { key: "" }, { key: "x".repeat(201) }, { key: 5 }, "{bad"]) {
      const res = await handleAccessPost(request({ method: "POST", body }), deps);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_request");
    }
  });

  it("rate-limits attempts per client, outside the daily model cap", async () => {
    expect(ROUTE_COSTS.access).toBe(1);
    expect(DAILY_CAP_EXEMPT.has("access")).toBe(true);
    const { deps, limiter } = setup(PROD, 3);
    for (let i = 0; i < 3; i++) {
      expect((await handleAccessPost(request({ method: "POST", body: { key: `guess${i}` } }), deps)).status).toBe(401);
    }
    const limited = await handleAccessPost(request({ method: "POST", body: { key: KEY } }), deps);
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toBe("rate_limited");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(limiter.usedToday()).toBe(0);
    // Another client still gets its own tries.
    expect((await handleAccessPost(request({ method: "POST", body: { key: KEY }, ip: "198.51.100.9" }), deps)).status).toBe(200);
  });

  it("returns 503 access_closed in production with no key, without charging the limiter", async () => {
    const { deps, limiter } = setup({ APP_ENV: "production" }, 1);
    const res = await handleAccessPost(request({ method: "POST", body: { key: KEY } }), deps);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("access_closed");
    expect(await limiter.limit(request(), "access")).toEqual({ allowed: true });
  });

  it("never logs the key, the cookie or ACCESS_KEY", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const limiter = createRateLimiter({ logger: () => {} });
    const token = accessToken(KEY);
    await handleAccessPost(request({ method: "POST", body: { key: KEY } }), { env: PROD, rateLimit: limiter.limit });
    await handleAccessPost(request({ method: "POST", body: { key: `${KEY}x` } }), { env: PROD, rateLimit: limiter.limit });
    handleAccessGet(request({ cookie: `${ACCESS_COOKIE}=${token}` }), { env: PROD });
    handleAccessDelete(request({ method: "DELETE", cookie: `${ACCESS_COOKIE}=${token}` }), { env: PROD });
    const written = JSON.stringify([info, log, error, warn].flatMap((spy) => spy.mock.calls));
    expect(info).toHaveBeenCalled();
    expect(written.includes(KEY)).toBe(false);
    expect(written.includes(token)).toBe(false);
  });
});

describe("GET and DELETE /api/access", () => {
  it("reports the access state for the request", async () => {
    const quiet = { logger: () => {} };
    const state = async (env: Record<string, string>, cookie?: string) =>
      (await handleAccessGet(request(cookie === undefined ? {} : { cookie }), { ...quiet, env }).json()).access;
    expect(await state(PROD)).toBe("denied");
    expect(await state(PROD, `${ACCESS_COOKIE}=${accessToken(KEY)}`)).toBe("granted");
    expect(await state({ APP_ENV: "production" })).toBe("closed");
    expect(await state({ APP_ENV: "development" })).toBe("open");
  });

  it("clears the cookie", async () => {
    const res = handleAccessDelete(request({ method: "DELETE" }), { env: PROD, logger: () => {} });
    expect(await res.json()).toEqual({ access: "denied" });
    const cookie = (res.headers.get("set-cookie") ?? "").split("; ");
    expect(cookie[0]).toBe(`${ACCESS_COOKIE}=`);
    expect(cookie).toContain("Max-Age=0");
  });
});

describe("access messages in the UI", () => {
  it("maps access codes to plain messages on every model route", () => {
    expect(errorMessage("convert", 401, { error: "access_required" })).toBe(ACCESS_ERRORS.access_required.message);
    expect(errorMessage("extract", 503, { error: "access_closed" })).toBe(ACCESS_ERRORS.access_closed.message);
    expect(errorMessage("check", 401, { error: "access_required" })).toMatch(/judges only/u);
    expect(errorMessage("access", 401, { error: "wrong_key" })).toBe("That access key is not right.");
  });
});
