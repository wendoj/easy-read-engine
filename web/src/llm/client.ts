import { z } from "zod";
import { type ChainEntry, type ModelConfig, type Provider, type Role, providerBaseUrls } from "./config";
import { type Transport, fetchTransport } from "./transport";

/** Output cap for `gpt-oss-120b` on Groq. Reasoning tokens count against the cap. */
export const GPT_OSS_MAX_TOKENS = 3000;
/**
 * Output cap for every model on Bedrock, which bills the tokens used, not the
 * cap. The per-task caps are sized for Groq's token budget. On Bedrock they
 * cut the judge and regenerate replies for long letters off mid-JSON.
 */
export const BEDROCK_MAX_TOKENS = 8000;
export const DEFAULT_TIMEOUT_MS = 45_000;
/**
 * Replies up to `BEDROCK_MAX_TOKENS` on a 1,000-word letter took 38 to 45
 * seconds, so 45 seconds cut them off and pushed the request to Groq, whose
 * smaller cap truncates again.
 */
export const BEDROCK_TIMEOUT_MS = 90_000;
/** Longest `Retry-After` the caller should wait before giving up. */
export const MAX_RETRY_AFTER_MS = 20_000;

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  /** OpenAI content parts (text and image_url) for vision. */
  content: string | unknown[] | null;
  [key: string]: unknown;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: unknown[];
  tool_choice?: unknown;
  temperature?: number;
  maxTokens?: number;
}

const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z.array(z.unknown()).optional(),
        }).passthrough(),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .passthrough()
    .optional(),
});

export type ChatResponseMessage = z.infer<typeof responseSchema>["choices"][number]["message"];
export type Usage = NonNullable<z.infer<typeof responseSchema>["usage"]>;

export type AttemptOutcome =
  | "ok"
  | "rate_limited"
  | "server_error"
  | "timeout"
  | "network_error"
  | "missing_key"
  | "unavailable"
  | "client_error"
  | "bad_response";

export interface AttemptRecord {
  provider: Provider;
  model: string;
  outcome: AttemptOutcome;
  status?: number;
  ms: number;
}

export interface ChatResult {
  message: ChatResponseMessage;
  finishReason: string | null;
  usage?: Usage;
  provider: Provider;
  model: string;
  attempts: AttemptRecord[];
}

/** Every entry in the chain failed with a 429, 5xx, 401, 403, 404, timeout or network error. */
export class ProviderChainError extends Error {
  constructor(
    readonly role: Role,
    readonly attempts: AttemptRecord[],
    /** Shortest `Retry-After` seen, capped at MAX_RETRY_AFTER_MS. */
    readonly retryAfterMs: number | undefined,
  ) {
    super(`All ${attempts.length} model providers for role "${role}" failed`);
    this.name = "ProviderChainError";
  }
}

/** A provider rejected the request (a 4xx other than 401, 403, 404 or 429) or sent a malformed reply. Not retried. */
export class ProviderRequestError extends Error {
  constructor(
    readonly role: Role,
    readonly attempt: AttemptRecord,
    readonly attempts: AttemptRecord[],
  ) {
    super(
      `Model provider ${attempt.provider}:${attempt.model} failed (${attempt.outcome}${
        attempt.status ? ` ${attempt.status}` : ""
      })`,
    );
    this.name = "ProviderRequestError";
  }
}

/** Never holds prompts, letter text, model output or keys. */
export interface ModelLogEvent {
  role: Role;
  provider: Provider;
  model: string;
  outcome: AttemptOutcome;
  status?: number;
  ms: number;
}

export type ModelLogger = (event: ModelLogEvent) => void;

const defaultLogger: ModelLogger = (event) => {
  console.info(JSON.stringify({ msg: "model_call", ...event }));
};

export interface ModelClientOptions {
  config: ModelConfig;
  transport?: Transport;
  timeoutMs?: number;
  logger?: ModelLogger;
  now?: () => number;
}

export interface ModelClient {
  chat(role: Role, request: ChatRequest): Promise<ChatResult>;
}

export function modelParams(role: Role, entry: ChainEntry, request: ChatRequest): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (request.maxTokens !== undefined) params.max_tokens = request.maxTokens;
  if (/gpt-oss-120b/i.test(entry.model)) {
    params.reasoning_effort = "low";
    params.max_tokens = Math.min(request.maxTokens ?? GPT_OSS_MAX_TOKENS, GPT_OSS_MAX_TOKENS);
  }
  if (entry.provider === "bedrock") params.max_tokens = BEDROCK_MAX_TOKENS;
  if (role === "judge" && entry.provider === "groq" && /qwen/i.test(entry.model)) {
    // Thinking off on Groq. The Bedrock judge (Qwen3 235B A22B Instruct 2507) has no thinking mode.
    params.reasoning_effort = "none";
  }
  return params;
}

export function buildBody(role: Role, entry: ChainEntry, request: ChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { model: entry.model, messages: request.messages };
  if (request.tools !== undefined) body.tools = request.tools;
  if (request.tool_choice !== undefined) body.tool_choice = request.tool_choice;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  return { ...body, ...modelParams(role, entry, request) };
}

/** Seconds or an HTTP date. */
export function parseRetryAfter(value: string | undefined, nowMs: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - nowMs);
}

/** 4xx statuses that mean "this entry can't serve the request", so the next entry is tried. */
export const FALLBACK_STATUSES: ReadonlySet<number> = new Set([401, 403, 404]);

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

export function createModelClient(options: ModelClientOptions): ModelClient {
  const { config } = options;
  const transport = options.transport ?? fetchTransport;
  const timeoutFor = (provider: Provider) =>
    options.timeoutMs ?? (provider === "bedrock" ? BEDROCK_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
  const log = options.logger ?? defaultLogger;
  const now = options.now ?? (() => performance.now());
  const baseUrls = config.baseUrls ?? providerBaseUrls();

  async function chat(role: Role, request: ChatRequest): Promise<ChatResult> {
    const chain = config.chains[role];
    const attempts: AttemptRecord[] = [];
    let retryAfterMs: number | undefined;

    const record = (entry: ChainEntry, outcome: AttemptOutcome, start: number, status?: number) => {
      const attempt: AttemptRecord = {
        provider: entry.provider,
        model: entry.model,
        outcome,
        ms: Math.round(now() - start),
        ...(status !== undefined ? { status } : {}),
      };
      attempts.push(attempt);
      log({ role, ...attempt });
      return attempt;
    };

    for (const entry of chain) {
      const start = now();
      const key = config.keys[entry.provider];
      if (!key) {
        record(entry, "missing_key", start);
        continue;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutFor(entry.provider));
      let res;
      try {
        res = await transport({
          url: `${baseUrls[entry.provider]}/chat/completions`,
          headers: { authorization: `Bearer ${key}` },
          body: buildBody(role, entry, request),
          signal: controller.signal,
        });
      } catch (err) {
        record(entry, isAbort(err) || controller.signal.aborted ? "timeout" : "network_error", start);
        continue;
      } finally {
        clearTimeout(timer);
      }

      if (res.status === 429 || res.status >= 500) {
        record(entry, res.status === 429 ? "rate_limited" : "server_error", start, res.status);
        const wait = parseRetryAfter(res.headers["retry-after"]);
        if (wait !== undefined) {
          retryAfterMs = Math.min(retryAfterMs ?? Infinity, wait, MAX_RETRY_AFTER_MS);
        }
        continue;
      }
      if (FALLBACK_STATUSES.has(res.status)) {
        // Bedrock: key rejected (401/403), model access not granted (403) or
        // model not offered in this Region (404). Groq: unknown model (404).
        record(entry, "unavailable", start, res.status);
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        const attempt = record(entry, "client_error", start, res.status);
        throw new ProviderRequestError(role, attempt, attempts);
      }
      const parsed = responseSchema.safeParse(res.json);
      if (!parsed.success) {
        const attempt = record(entry, "bad_response", start, res.status);
        throw new ProviderRequestError(role, attempt, attempts);
      }
      record(entry, "ok", start, res.status);
      const choice = parsed.data.choices[0];
      return {
        message: choice.message,
        finishReason: choice.finish_reason ?? null,
        usage: parsed.data.usage,
        provider: entry.provider,
        model: entry.model,
        attempts,
      };
    }
    throw new ProviderChainError(role, attempts, retryAfterMs);
  }

  return { chat };
}
