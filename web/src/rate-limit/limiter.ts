/**
 * Shared limits for `/api/extract`, `/api/convert` and `/api/check`
 * (design "Protecting the live quota" and "Error Handling").
 *
 * Both limits count units of roughly 1 model request, so the three routes
 * draw on the same allowance:
 * - convert costs 6: 1 rewrite, up to 3 judge calls and up to 2 regenerates.
 * - extract and check cost 1: 1 vision call, or 1 judge call on edited lines.
 *
 * 1. Per client, a token bucket shared by all three routes. 429 with
 *    Retry-After when it is empty.
 * 2. Globally, a daily cap that resets at 00:00 UTC. 503 with "Daily limit
 *    reached, try again tomorrow" before any work starts. A conversion is
 *    charged in full up front, so it never runs out partway through.
 *
 * A request is charged only when both limits allow it. State is in memory,
 * which is fine for the single instance on the VPS; it resets on restart.
 */
import { DEFAULT_TRUSTED_PROXY_HOPS, clientKey, maskClientKey } from "./client-ip";
import { type BucketConfig, type BucketState, fullBucket, msUntilAvailable, refill, take } from "./token-bucket";
import type { LimitedRoute, RateLimitDecision, RateLimiter } from "./types";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const ROUTE_COSTS: Record<LimitedRoute, number> = { convert: 6, extract: 1, check: 1 };

/**
 * 30 units an hour per client: 5 conversions, or fewer conversions plus
 * uploads and edit checks. The design's example was 10 conversions an hour,
 * but with a daily cap of about 25 conversions that would let one visitor use
 * 40% of a day's allowance.
 */
export const PER_CLIENT_CAPACITY = 30;
export const PER_CLIENT_REFILL_PER_HOUR = 30;

/**
 * Just under the combined free allowance (design "Token budget"): Groq's
 * 200,000 tokens a day is about 50 rewrite requests (4,000 tokens each) and
 * 66 judge requests (3,000 each), plus OpenRouter's 50 free requests. That is
 * about 166 requests; 150 leaves some room for the estimates being low.
 */
export const DAILY_CAP = 150;

export const RATE_LIMITED_MESSAGE = (minutes: number) =>
  `You have sent a lot of requests in a short time. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
export const DAILY_LIMIT_MESSAGE = "Daily limit reached, try again tomorrow";

/** Log event. The client is masked to a /24 or /48, never the full address. */
export interface RateLimitLogEvent {
  msg: "rate_limit";
  route: LimitedRoute;
  code: "rate_limited" | "daily_limit";
  client: string;
}

export interface RateLimiterOptions {
  capacity?: number;
  refillPerHour?: number;
  dailyCap?: number;
  costs?: Record<LimitedRoute, number>;
  trustedProxyHops?: number;
  /** Wall-clock milliseconds. Defaults to `Date.now`. */
  now?: () => number;
  logger?: (event: RateLimitLogEvent) => void;
  /** Sweep refilled buckets once the map holds this many clients. */
  maxTrackedClients?: number;
}

export interface RateLimiterInstance {
  limit: RateLimiter;
  /** Units charged today against the daily cap. For tests and diagnostics. */
  usedToday(): number;
}

const defaultLogger = (event: RateLimitLogEvent) => console.info(JSON.stringify(event));

function utcDay(nowMs: number): number {
  return Math.floor(nowMs / DAY_MS);
}

export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiterInstance {
  const costs = options.costs ?? ROUTE_COSTS;
  const config: BucketConfig = {
    capacity: options.capacity ?? PER_CLIENT_CAPACITY,
    refillPerMs: (options.refillPerHour ?? PER_CLIENT_REFILL_PER_HOUR) / HOUR_MS,
  };
  const dailyCap = options.dailyCap ?? DAILY_CAP;
  const hops = options.trustedProxyHops ?? DEFAULT_TRUSTED_PROXY_HOPS;
  const now = options.now ?? Date.now;
  const log = options.logger ?? defaultLogger;
  const maxTracked = options.maxTrackedClients ?? 10_000;

  for (const [route, cost] of Object.entries(costs)) {
    if (!(cost > 0) || cost > config.capacity || cost > dailyCap) {
      throw new Error(`rate limit cost for ${route} must be above 0 and within both limits`);
    }
  }
  if (!(config.refillPerMs > 0)) throw new Error("rate limit refill must be above 0");

  const buckets = new Map<string, BucketState>();
  let day = utcDay(now());
  let used = 0;

  function sweep(nowMs: number) {
    for (const [key, state] of buckets) {
      if (refill(state, config, nowMs).tokens >= config.capacity) buckets.delete(key);
    }
  }

  function deny(route: LimitedRoute, key: string, decision: Extract<RateLimitDecision, { allowed: false }>) {
    log({ msg: "rate_limit", route, code: decision.code, client: maskClientKey(key) });
    return decision;
  }

  const limit: RateLimiter = async (request, route) => {
    const nowMs = now();
    const cost = costs[route];
    const key = clientKey(request.headers, hops);

    const today = utcDay(nowMs);
    if (today !== day) {
      day = today;
      used = 0;
    }
    if (used + cost > dailyCap) {
      const untilMidnight = (today + 1) * DAY_MS - nowMs;
      return deny(route, key, {
        allowed: false,
        status: 503,
        code: "daily_limit",
        message: DAILY_LIMIT_MESSAGE,
        retryAfterSeconds: Math.max(1, Math.ceil(untilMidnight / 1000)),
      });
    }

    const result = take(buckets.get(key) ?? fullBucket(config, nowMs), config, cost, nowMs);
    if (!result.allowed) {
      buckets.set(key, result.state);
      const waitMs = msUntilAvailable(result.state, config, cost);
      const seconds = Math.max(1, Math.ceil(waitMs / 1000));
      return deny(route, key, {
        allowed: false,
        status: 429,
        code: "rate_limited",
        message: RATE_LIMITED_MESSAGE(Math.max(1, Math.ceil(seconds / 60))),
        retryAfterSeconds: seconds,
      });
    }

    if (!buckets.has(key) && buckets.size >= maxTracked) sweep(nowMs);
    buckets.set(key, result.state);
    used += cost;
    return { allowed: true };
  };

  return { limit, usedToday: () => (utcDay(now()) === day ? used : 0) };
}
