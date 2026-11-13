/**
 * `POST /api/convert`: streams the conversion as newline-delimited JSON
 * (`progress` events, then 1 `result` or `error` event).
 *
 * Access, body, checker health and rate limits are checked in that order, so
 * nothing spends model quota unless it can finish. A failure after the stream
 * starts is sent as a final `error` event with the status the route would
 * have returned.
 */
import { z } from "zod";
import { type AccessGate, requireAccess } from "@/src/access/key";
import { CheckerUnavailable } from "@/src/checker-client/errors";
import { type RouteFailure, errorName, errorResponse, rateLimitFailure, readJson } from "@/src/http/response";
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
  /** Judge access check. Runs first, so a denied request costs no rate-limit units. */
  access?: AccessGate;
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

type Failure = RouteFailure<ConvertErrorCode>;

function failure(error: keyof typeof CONVERT_ERRORS, retryAfterSeconds?: number): Failure {
  return { error, ...CONVERT_ERRORS[error], ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) };
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


type Parsed = { ok: true; original: string } | { ok: false; failure: Failure };

async function parseRequest(request: Request): Promise<Parsed> {
  const read = await readJson(request, MAX_BODY_BYTES);
  if (!read.ok) return { ok: false, failure: failure(read.reason === "too_large" ? "too_large" : "invalid_request") };
  // zod issues are not passed on: some quote the received value.
  const parsed = bodySchema.safeParse(read.json);
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
      ...(outcome === "internal" ? errorName(err) : {}),
      ms: Math.round(now() - started),
    });
  const reject = (f: Failure, err?: unknown) => {
    finish(f.error, f.status, false, err);
    return errorResponse(f);
  };

  const denied = (deps.access ?? requireAccess)(request);
  if (denied) return reject(failure(denied.error));

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
    return reject(rateLimitFailure(limit));
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
