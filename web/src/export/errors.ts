/**
 * Error codes, statuses and messages for `/api/export` (design "Error
 * Handling"). Fixed text, never letter content. No server imports, so the
 * client can use the table too.
 */
export type ExportErrorCode =
  | "invalid_request"
  | "too_large"
  | "blocked"
  | "checker_unavailable"
  | "busy"
  | "export_unavailable"
  | "export_failed"
  | "rate_limited"
  | "daily_limit"
  | "internal";

/** A full `ConversionResult`: a 1,500-word letter, its sentences, key facts, lines and checks. */
export const MAX_EXPORT_BODY_BYTES = 1024 * 1024;

export const EXPORT_FILENAME = "easy-read.pdf";

export const EXPORT_ERRORS: Record<Exclude<ExportErrorCode, "rate_limited" | "daily_limit">, { status: number; message: string }> = {
  invalid_request: {
    status: 400,
    message: "This Easy Read version can't be exported. Go back and convert the letter again.",
  },
  too_large: { status: 413, message: "This Easy Read version is too big to export." },
  blocked: {
    status: 409,
    message: "This Easy Read version can't be exported, because a key fact in it doesn't match the letter.",
  },
  checker_unavailable: {
    status: 503,
    message: "The service that checks the Easy Read version isn't working right now. Try again in a few minutes.",
  },
  busy: { status: 503, message: "A lot of PDFs are being made right now. Try again in a minute." },
  export_unavailable: { status: 503, message: "Export isn't working right now. Try again later." },
  export_failed: { status: 500, message: "The PDF couldn't be made. Try again in a minute." },
  internal: { status: 500, message: "Something went wrong. Try again in a minute." },
};
