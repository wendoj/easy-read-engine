export type LimitedRoute = "extract" | "convert" | "check" | "export";

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
