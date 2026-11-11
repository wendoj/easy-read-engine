/**
 * Error codes, statuses and messages for `/api/check` (design "Error
 * Handling"). Messages are fixed text and never include letter content or
 * line text. No server imports, so client code can use the table too.
 */
export type CheckErrorCode =
  | "invalid_request"
  | "empty_line"
  | "too_long"
  | "too_large"
  | "checker_unavailable"
  | "rate_limited"
  | "daily_limit"
  | "internal";

/** Largest request body read: a 15,000-character letter, 400 lines and the previous checks. */
export const MAX_CHECK_BODY_BYTES = 512 * 1024;

/** Most lines in one request. The checker accepts up to 400. */
export const MAX_CHECK_LINES = 400;

/** Longest line text. Well under the checker's 1,000, and far above a 15-word Easy Read line. */
export const MAX_EDIT_LINE_CHARS = 300;

/** Longest line, sentence or symbol ID. Same as the checker's `MAX_ID_CHARS`. */
export const MAX_ID_CHARS = 64;

export const CHECK_ERRORS: Record<Exclude<CheckErrorCode, "rate_limited" | "daily_limit">, { status: number; message: string }> = {
  invalid_request: {
    status: 400,
    message: "This edit can't be checked. Go back and convert the letter again.",
  },
  empty_line: {
    status: 400,
    message: "A line can't be empty. Write some text or select Cancel.",
  },
  too_long: {
    status: 400,
    message: `A line can have up to ${MAX_EDIT_LINE_CHARS} characters. Make the line shorter.`,
  },
  too_large: {
    status: 413,
    message: "This request is too big to check.",
  },
  checker_unavailable: {
    status: 503,
    message: "The service that checks the Easy Read version isn't working right now. Try again in a few minutes.",
  },
  internal: {
    status: 500,
    message: "Something went wrong. Try again in a minute.",
  },
};
