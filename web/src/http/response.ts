import type { RateLimitDecision } from "@/src/rate-limit/types";

export const NO_STORE = { "cache-control": "no-store" };

export interface RouteFailure<Code extends string = string> {
  error: Code;
  status: number;
  message: string;
  retryAfterSeconds?: number;
}

export function errorResponse(f: RouteFailure): Response {
  const headers: Record<string, string> = { ...NO_STORE };
  if (f.retryAfterSeconds !== undefined) headers["retry-after"] = String(f.retryAfterSeconds);
  return Response.json({ error: f.error, message: f.message }, { status: f.status, headers });
}

export function rateLimitFailure(
  limit: Extract<RateLimitDecision, { allowed: false }>,
): RouteFailure<"rate_limited" | "daily_limit"> {
  return {
    error: limit.code,
    status: limit.status,
    message: limit.message,
    ...(limit.retryAfterSeconds !== undefined ? { retryAfterSeconds: limit.retryAfterSeconds } : {}),
  };
}

/** Log events hold codes, counts, timings and rule results only, never letter text. */
export const logJson = (event: object): void => console.info(JSON.stringify(event));

/** Whole milliseconds since the call. */
export function stopwatch(now: () => number = () => performance.now()): () => number {
  const started = now();
  return () => Math.round(now() - started);
}

/** Errors are logged by class name only: their messages could quote letter text. */
export function errorName(err: unknown): { errorName?: string } {
  return err instanceof Error ? { errorName: err.name } : {};
}

/** At most `limit` bytes of UTF-8. Null when the body is longer or can't be read. */
export async function readBody(request: Request, limit: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export type JsonBody = { ok: true; json: unknown } | { ok: false; reason: "too_large" | "invalid_json" };

/** Rejects on the declared length before reading, then on the real length. */
export async function readJson(request: Request, limit: number): Promise<JsonBody> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return { ok: false, reason: "too_large" };
  const raw = await readBody(request, limit);
  if (raw === null) return { ok: false, reason: "too_large" };
  try {
    return { ok: true, json: JSON.parse(raw) };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}
