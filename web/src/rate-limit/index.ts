/**
 * Hook point for the shared limits on `/api/extract`, `/api/convert` and
 * `/api/check` (design "Protecting the live quota").
 *
 * TODO(task 17): replace the body with the per-IP token bucket and the global
 * daily cap. Until then every request is allowed. Callers already handle the
 * `allowed: false` case, so only this file needs to change.
 */

export type LimitedRoute = "extract" | "convert" | "check";

export type RateLimitDecision =
  | { allowed: true }
  | {
      allowed: false;
      /** 429 for the per-IP limit, 503 for the daily cap. */
      status: 429 | 503;
      code: "rate_limited" | "daily_limit";
      message: string;
      retryAfterSeconds?: number;
    };

export type RateLimiter = (request: Request, route: LimitedRoute) => Promise<RateLimitDecision>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const rateLimit: RateLimiter = async (_request, _route) => ({ allowed: true });
