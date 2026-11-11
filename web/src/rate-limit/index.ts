/**
 * Shared limits on `/api/extract`, `/api/convert` and `/api/check`
 * (design "Protecting the live quota"). See `limiter.ts`.
 *
 * `rateLimit` uses 1 limiter per server process. It is kept on `globalThis`
 * so every route handler bundle, and module reloads in `next dev`, share the
 * same buckets and daily count.
 */
import { type RateLimiterInstance, createRateLimiter } from "./limiter";
import type { RateLimiter } from "./types";

export * from "./types";
export * from "./limiter";
export * from "./token-bucket";
export * from "./client-ip";

const SHARED = Symbol.for("easy-read.rate-limiter");

function shared(): RateLimiterInstance {
  const store = globalThis as unknown as Record<symbol, RateLimiterInstance | undefined>;
  return (store[SHARED] ??= createRateLimiter());
}

export const rateLimit: RateLimiter = (request, route) => shared().limit(request, route);
