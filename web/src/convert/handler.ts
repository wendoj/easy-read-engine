/**
 * `POST /api/convert` as a plain `Request -> Response` function, so tests can
 * call it without Next.js. The route file only wires in the real clients.
 *
 * Input: `{ original: string }`, the confirmed text (R1.6). It is passed to the
 * pipeline unchanged.
 *
 * Order, so that nothing spends model quota unless it can finish:
 * 1. Body size, JSON and zod, then the 1,500-word limit (R1.7): 400 or 413.
 * 2. Checker health: 503 if it's down, because unchecked output is never shown.
 * 3. Model config, then the shared rate limits: 429, or 503 for the daily cap.
 * 4. Stream newline-delimited JSON: `progress` events, then 1 `result` event
 *    with the `ConversionResult`. A failure after the stream starts is sent as
 *    a final `error` event holding the status the route would have returned.
 *
 * Nothing is stored. Logs hold the outcome, the status and the time. Never the
 * body, letter text, lines or key-fact values (R7.4).
 */
import { z } from "zod";
import { CheckerUnavailable } from "@/src/checker-client/errors";
import { ProviderChainError, ProviderRequestError } from "@/src/llm/client";
import { ModelOutputError } from "@/src/llm/structured";
import {
  type ConversionResult,
  type PipelineChecker,
  type PipelineLogger,
  type PipelineModel,
  type ProgressEvent,
  convert,
} from "@/src/pipeline";
import { type RateLimiter, rateLimit as defaultRateLimit } from "@/src/rate-limit";
import { CONVERT_ERRORS, type ConvertErrorCode, MAX_BODY_BYTES } from "./errors";
import { TOO_MANY_CHARACTERS_MESSAGE, countWords, letterLengthProblem, tooLongMessage } from "./word-count";

export interface ConvertChecker extends PipelineChecker {
  /** Throws `CheckerUnavailable` when the service is down or starting. */
  health(): Promise<{ status: "ok" | "starting" }>;
}

export interface ConvertHandlerDeps {
  getChecker: () => ConvertChecker;
  /** Built only after the checker and limits allow the request. */
  getModel: () => PipelineModel;
  rateLimit?: RateLimiter;
  /** Used once per conversion to wait for the shortest `Retry-After`. */
  sleep?: (ms: number) => Promise<void>;
  logger?: (event: ConvertLogEvent) => void;
  pipelineLogger?: PipelineLogger;
  now?: () => number;
}

export interface ConvertErrorEvent {
  type: "error";
  error: ConvertErrorCode;
  status: number;
  message: string;
  retryAfterSeconds?: number;
}

export interface ConvertResultEvent {
  type: "result";
  result: ConversionResult;
}

/** One line of the `/api/convert` stream. */
export type ConvertEvent = ProgressEvent | ConvertResultEvent | ConvertErrorEvent;

/** Log event. No letter content, no client address. */
export interface ConvertLogEvent {
  msg: "convert_request";
  outcome: "ok" | ConvertErrorCode;
  status: number;
  /** Set once streaming started; the HTTP status is then 200. */
  streamed: boolean;
  /** Error class name for `internal`, to tell failures apart without their messages. */
  errorName?: string;
  ms: number;
}

const bodySchema = z.object({ original: z.string() });

const NO_STORE = { "cache-control": "no-store" };

const STREAM_HEADERS = {
  "content-type": "application/x-ndjson; charset=utf-8",
  // no-transform asks proxies not to compress, which would buffer the stream.
  "cache-control": "no-store, no-transform",
  "x-content-type-options": "nosniff",
  // Some proxies (nginx) buffer unless told not to. Traefik doesn't buffer by default.
  "x-accel-buffering": "no",
};

const defaultLogger = (event: ConvertLogEvent) => console.info(JSON.stringify(event));
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface Failure {
  error: ConvertErrorCode;
  status: number;
  message: string;
  retryAfterSeconds?: number;
}

function failure(error: keyof typeof CONVERT_ERRORS, retryAfterSeconds?: number): Failure {
  return { error, ...CONVERT_ERRORS[error], ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) };
}

function errorResponse(f: Failure): Response {
  const headers: Record<string, string> = { ...NO_STORE };
  if (f.retryAfterSeconds !== undefined) headers["retry-after"] = String(f.retryAfterSeconds);
  return Response.json({ error: f.error, message: f.message }, { status: f.status, headers });
}

/** Map a pipeline error to a failure. The error's own message is never used. */
export function classifyError(err: unknown): Failure {
  if (err instanceof CheckerUnavailable) return failure("checker_unavailable");
  if (err instanceof ProviderChainError) {
    const seconds = err.retryAfterMs !== undefined ? Math.max(1, Math.ceil(err.retryAfterMs / 1000)) : undefined;
    return failure("providers_unavailable", seconds);
  }
  if (err instanceof ModelOutputError || err instanceof ProviderRequestError) return failure("model_output_invalid");
  return failure("internal");
}

/**
 * Design "Error Handling": when every provider fails, wait once for the
 * shortest `Retry-After` (the client caps it at 20 seconds) and try that call
 * again. Once per conversion, so a conversion waits at most once. The judge
 * catches chain failures itself and flags P9 and P10, so it isn't wrapped.
 */
export function withRetryAfterOnce(model: PipelineModel, sleep: (ms: number) => Promise<void>): PipelineModel {
  let waited = false;
  async function once<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      if (waited || !(err instanceof ProviderChainError) || err.retryAfterMs === undefined) throw err;
      waited = true;
      await sleep(err.retryAfterMs);
      return call();
    }
  }
  return {
    rewrite: (input) => once(() => model.rewrite(input)),
    regenerate: (input) => once(() => model.regenerate(input)),
    judge: (pairs) => model.judge(pairs),
  };
}

/** Read at most `limit` bytes of the body. Null when it is longer or can't be read. Also used by `/api/check`. */
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

type Parsed = { ok: true; original: string } | { ok: false; failure: Failure };

async function parseRequest(request: Request): Promise<Parsed> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { ok: false, failure: failure("too_large") };

  const raw = await readBody(request, MAX_BODY_BYTES);
  if (raw === null) return { ok: false, failure: failure("too_large") };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, failure: failure("invalid_request") };
  }
  // zod issues are not passed on: some quote the received value.
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return { ok: false, failure: failure("invalid_request") };

  const { original } = parsed.data;
  switch (letterLengthProblem(original)) {
    case "empty":
      return { ok: false, failure: failure("empty") };
    case "too_many_characters":
      return { ok: false, failure: { error: "too_long", status: 400, message: TOO_MANY_CHARACTERS_MESSAGE } };
    case "too_many_words":
      return { ok: false, failure: { error: "too_long", status: 400, message: tooLongMessage(countWords(original)) } };
    default:
      return { ok: true, original };
  }
}

export async function handleConvert(request: Request, deps: ConvertHandlerDeps): Promise<Response> {
  const log = deps.logger ?? defaultLogger;
  const now = deps.now ?? (() => performance.now());
  const started = now();
  const finish = (outcome: ConvertLogEvent["outcome"], status: number, streamed: boolean, err?: unknown) =>
    log({
      msg: "convert_request",
      outcome,
      status,
      streamed,
      ...(outcome === "internal" && err instanceof Error ? { errorName: err.name } : {}),
      ms: Math.round(now() - started),
    });
  const reject = (f: Failure, err?: unknown) => {
    finish(f.error, f.status, false, err);
    return errorResponse(f);
  };

  const parsed = await parseRequest(request);
  if (!parsed.ok) return reject(parsed.failure);
  const { original } = parsed;

  let checker: ConvertChecker;
  try {
    checker = deps.getChecker();
    const health = await checker.health();
    if (health.status !== "ok") return reject(failure("checker_unavailable"));
  } catch (err) {
    return reject(classifyError(err), err);
  }

  let model: PipelineModel;
  try {
    model = withRetryAfterOnce(deps.getModel(), deps.sleep ?? defaultSleep);
  } catch (err) {
    return reject(failure("internal"), err);
  }

  const limit = await (deps.rateLimit ?? defaultRateLimit)(request, "convert");
  if (!limit.allowed) {
    return reject({
      error: limit.code,
      status: limit.status,
      message: limit.message,
      ...(limit.retryAfterSeconds !== undefined ? { retryAfterSeconds: limit.retryAfterSeconds } : {}),
    });
  }

  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ConvertEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      try {
        const result = await convert(original, {
          model,
          checker,
          onProgress: send,
          ...(deps.pipelineLogger ? { logger: deps.pipelineLogger } : {}),
        });
        send({ type: "result", result });
        finish("ok", 200, true);
      } catch (err) {
        const f = classifyError(err);
        send({ type: "error", ...f });
        finish(f.error, f.status, true, err);
      } finally {
        if (open) {
          open = false;
          controller.close();
        }
      }
    },
    cancel() {
      // The client left. The pipeline finishes its current call, and nothing more is sent.
      open = false;
    },
  });

  return new Response(stream, { status: 200, headers: STREAM_HEADERS });
}
