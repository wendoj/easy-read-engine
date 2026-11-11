/**
 * Plain messages for errors from `/api/extract`, `/api/convert`, `/api/check`,
 * `/api/sample` and `/api/export`.
 *
 * Fixed messages come from the same tables the routes use. Messages that hold
 * numbers (the word limit, the rate-limit wait) come from the server. When the
 * body isn't one of ours (for example a proxy error page), the HTTP status
 * picks the message. Messages never include letter content.
 */
import { CHECK_ERRORS } from "@/src/check/errors";
import { CONVERT_ERRORS } from "@/src/convert/errors";
import { EXPORT_ERRORS } from "@/src/export/errors";
import { EXTRACT_ERRORS } from "@/src/extract/errors";
import { MAX_WORDS } from "@/src/convert/word-count";
import { SAMPLE_ERRORS } from "@/src/samples/errors";

export type ApiRoute = "extract" | "convert" | "check" | "sample" | "export";

export const RATE_LIMITED_FALLBACK = "You have sent too many letters. Try again in a few minutes.";
export const DAILY_LIMIT_FALLBACK = "Daily limit reached, try again tomorrow";
export const BUSY_FALLBACK = "The service isn't working right now. Try again in a few minutes.";
export const NETWORK_MESSAGE = "The service can't be reached. Check your internet connection and try again.";
export const STREAM_BROKEN_MESSAGE = "The connection stopped before the Easy Read version was ready. Try again.";
export const GENERIC_MESSAGE = "Something went wrong. Try again in a minute.";
export const TOO_LONG_FALLBACK = `This letter is too long. Letters can have up to ${MAX_WORDS.toLocaleString("en-GB")} words. Remove some text and try again.`;

/** Codes whose server message holds a number, so the server text is shown. */
const SERVER_MESSAGE_CODES = new Set(["too_long", "rate_limited", "daily_limit"]);

const TABLES: Record<ApiRoute, Record<string, { status: number; message: string }>> = {
  extract: EXTRACT_ERRORS,
  convert: CONVERT_ERRORS,
  check: CHECK_ERRORS,
  sample: SAMPLE_ERRORS,
  export: EXPORT_ERRORS,
};

const MAX_SERVER_MESSAGE = 300;

function serverMessage(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" && value.length <= MAX_SERVER_MESSAGE ? value : null;
}

function fallbackFor(code: string): string | null {
  if (code === "rate_limited") return RATE_LIMITED_FALLBACK;
  if (code === "daily_limit") return DAILY_LIMIT_FALLBACK;
  if (code === "too_long") return TOO_LONG_FALLBACK;
  return null;
}

function messageForStatus(route: ApiRoute, status: number): string {
  if (status === 429) return RATE_LIMITED_FALLBACK;
  if (status === 413) return TABLES[route].too_large?.message ?? GENERIC_MESSAGE;
  if (status === 503) return BUSY_FALLBACK;
  return GENERIC_MESSAGE;
}

/**
 * The message to show for an error. `body` is the parsed JSON body of a
 * non-200 response, or an `error` event from the convert stream.
 */
export function errorMessage(route: ApiRoute, status: number, body: unknown): string {
  const record = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const code = typeof record.error === "string" ? record.error : null;
  if (code !== null) {
    if (SERVER_MESSAGE_CODES.has(code)) {
      const fromServer = serverMessage(record.message);
      const fallback = fallbackFor(code);
      if (fromServer) return fromServer;
      if (fallback) return fallback;
    }
    const known = Object.hasOwn(TABLES[route], code) ? TABLES[route][code] : undefined;
    if (known) return known.message;
  }
  return messageForStatus(route, status);
}

/** Reads a non-200 response body as JSON, or null when it isn't JSON. */
export async function readErrorBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
