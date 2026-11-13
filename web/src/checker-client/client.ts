/**
 * Network errors, timeouts, 5xx and invalid responses throw
 * `CheckerUnavailable`, so routes return 503 and unchecked output is never
 * shown. 4xx throws `CheckerRequestError`. Nothing here logs, and no error
 * carries request or response content.
 */
import type { z } from "zod";
import { type CheckerRoute, CheckerRequestError, CheckerUnavailable } from "./errors";
import {
  type ActionSynonym,
  type Analysis,
  type CheckRequest,
  type CheckResult,
  type Health,
  type KeyFact,
  type LineFactSpan,
  type LineFactsRequest,
  type SymbolMatch,
  type ValidationIssue,
  actionSynonymSchema,
  analysisSchema,
  checkResultSchema,
  healthSchema,
  keyFactSchema,
  lineFactSpanSchema,
  symbolMatchSchema,
  validationErrorSchema,
} from "./schemas";

/** Per-request timeout. spaCy on a 1,500-word letter takes well under this. */
export const DEFAULT_CHECKER_TIMEOUT_MS = 10_000;

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

export interface CheckerClientOptions {
  /** Defaults to `process.env.CHECKER_URL`. */
  baseUrl?: string;
  timeoutMs?: number;
  /** Injectable for tests. Defaults to global `fetch`. */
  fetch?: FetchFn;
}

export interface CheckerClient {
  analyse(original: string): Promise<Analysis>;
  keyFacts(text: string): Promise<KeyFact[]>;
  check(request: CheckRequest): Promise<CheckResult[]>;
  /** Matched by P1's normalised values. */
  lineFacts(request: LineFactsRequest): Promise<LineFactSpan[]>;
  symbols(q: string, limit?: number): Promise<SymbolMatch[]>;
  /** P1's action synonym table, for the rule report. */
  actionSynonyms(): Promise<ActionSynonym[]>;
  health(): Promise<Health>;
}

/** `CHECKER_URL` is missing or isn't an http(s) URL. A deployment error, not a 503. */
export class CheckerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckerConfigError";
  }
}

function resolveBaseUrl(raw: string | undefined): string {
  if (!raw) throw new CheckerConfigError("CHECKER_URL is not set");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CheckerConfigError("CHECKER_URL is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CheckerConfigError("CHECKER_URL must use http or https");
  }
  return url.toString().replace(/\/+$/, "");
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

export function createCheckerClient(options: CheckerClientOptions = {}): CheckerClient {
  const baseUrl = resolveBaseUrl(options.baseUrl ?? process.env.CHECKER_URL);
  const timeoutMs = options.timeoutMs ?? DEFAULT_CHECKER_TIMEOUT_MS;
  const fetchFn: FetchFn = options.fetch ?? ((input, init) => fetch(input, init));

  async function request<S extends z.ZodType>(
    route: CheckerRoute,
    init: { method: "GET" | "POST"; query?: URLSearchParams; body?: unknown },
    schema: S,
  ): Promise<z.infer<S>> {
    const url = `${baseUrl}${route}${init.query ? `?${init.query.toString()}` : ""}`;
    const signal = AbortSignal.timeout(timeoutMs);

    let status: number;
    let json: unknown;
    try {
      const res = await fetchFn(url, {
        method: init.method,
        headers: {
          accept: "application/json",
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal,
      });
      status = res.status;
      // Read the body under the same timeout. A body that isn't JSON is
      // handled per status below.
      try {
        json = await res.json();
      } catch (err) {
        if (signal.aborted || isTimeout(err)) throw err;
        json = undefined;
      }
    } catch (err) {
      // The cause is dropped on purpose: it can hold the URL, and the
      // `/symbols` query carries words from Easy Read lines.
      throw new CheckerUnavailable(route, signal.aborted || isTimeout(err) ? "timeout" : "network");
    }

    if (status >= 500) throw new CheckerUnavailable(route, "server_error", status);
    if (status >= 400) {
      const parsed = validationErrorSchema.safeParse(json);
      const issues: ValidationIssue[] = parsed.success ? parsed.data.detail : [];
      throw new CheckerRequestError(route, status, issues);
    }
    if (status < 200 || status >= 300) throw new CheckerUnavailable(route, "invalid_response", status);

    const parsed = schema.safeParse(json);
    // zod issue messages are not passed on: some quote the received value.
    if (!parsed.success) throw new CheckerUnavailable(route, "invalid_response", status);
    return parsed.data;
  }

  return {
    analyse: (original) => request("/analyse", { method: "POST", body: { original } }, analysisSchema),
    keyFacts: (text) => request("/key-facts", { method: "POST", body: { text } }, keyFactSchema.array()),
    check: ({ original, key_facts, lines }) =>
      request("/check", { method: "POST", body: { original, key_facts, lines } }, checkResultSchema.array()),
    lineFacts: ({ key_facts, lines }) =>
      request("/line-facts", { method: "POST", body: { key_facts, lines } }, lineFactSpanSchema.array()),
    symbols: (q, limit) => {
      const query = new URLSearchParams({ q });
      if (limit !== undefined) query.set("limit", String(limit));
      return request("/symbols", { method: "GET", query }, symbolMatchSchema.array());
    },
    actionSynonyms: () => request("/config/action-synonyms", { method: "GET" }, actionSynonymSchema.array()),
    health: () => request("/health", { method: "GET" }, healthSchema),
  };
}
