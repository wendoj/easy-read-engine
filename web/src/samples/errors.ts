/**
 * Error codes, statuses and messages for `/api/sample`. Fixed text, no server
 * imports, so the client can use the table too.
 */
export type SampleErrorCode = "invalid_request" | "not_found" | "checker_unavailable" | "sample_outdated" | "internal";

/** The body is `{ "id": "<sample id>" }`. */
export const MAX_SAMPLE_BODY_BYTES = 1024;

export const SAMPLE_ERRORS: Record<SampleErrorCode, { status: number; message: string }> = {
  invalid_request: { status: 400, message: "This sample letter can't be loaded. Choose one from the list." },
  not_found: { status: 404, message: "This sample letter isn't available. Choose another one from the list." },
  checker_unavailable: {
    status: 503,
    message: "The service that checks the Easy Read version isn't working right now. Try again in a few minutes.",
  },
  sample_outdated: {
    status: 500,
    message: "This sample letter can't be shown right now. Choose another one or paste a letter.",
  },
  internal: { status: 500, message: "Something went wrong. Try again in a minute." },
};
