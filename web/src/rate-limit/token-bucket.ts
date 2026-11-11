/**
 * A token bucket as pure functions, so the limiter and its property test use
 * the same arithmetic. Times are in milliseconds.
 */
export interface BucketConfig {
  /** Most tokens the bucket holds. Also the largest burst. */
  capacity: number;
  /** Tokens added per millisecond. */
  refillPerMs: number;
}

export interface BucketState {
  tokens: number;
  updatedMs: number;
}

export function fullBucket(config: BucketConfig, nowMs: number): BucketState {
  return { tokens: config.capacity, updatedMs: nowMs };
}

/** Add the tokens earned since the last update. A clock that goes back adds nothing. */
export function refill(state: BucketState, config: BucketConfig, nowMs: number): BucketState {
  const elapsed = Math.max(0, nowMs - state.updatedMs);
  return {
    tokens: Math.min(config.capacity, state.tokens + elapsed * config.refillPerMs),
    updatedMs: Math.max(state.updatedMs, nowMs),
  };
}

/** Milliseconds until a refilled bucket holds `cost` tokens. 0 when it already does. */
export function msUntilAvailable(state: BucketState, config: BucketConfig, cost: number): number {
  if (state.tokens >= cost) return 0;
  return Math.ceil((cost - state.tokens) / config.refillPerMs);
}

/**
 * Take `cost` tokens if the bucket has them. `state` is the bucket after
 * refilling, whether or not the take succeeded.
 */
export function take(
  state: BucketState,
  config: BucketConfig,
  cost: number,
  nowMs: number,
): { allowed: boolean; state: BucketState } {
  const current = refill(state, config, nowMs);
  if (current.tokens < cost) return { allowed: false, state: current };
  return { allowed: true, state: { tokens: current.tokens - cost, updatedMs: current.updatedMs } };
}
