/**
 * Error codes, statuses and messages for `/api/convert` (design "Error
 * Handling"). Messages are fixed text and never include letter content.
 */
import { ACCESS_ERRORS } from "@/src/access/errors";

export type ConvertErrorCode =
  | "invalid_request"
  | "empty"
  | "too_long"
  | "too_large"
  | "checker_unavailable"
  | "providers_unavailable"
  | "model_output_invalid"
  | "rate_limited"
  | "daily_limit"
  | "access_required"
  | "access_closed"
  | "internal";

/** Largest request body read. A 15,000-character letter fits with room for JSON escapes. */
export const MAX_BODY_BYTES = 128 * 1024;

export const CONVERT_ERRORS: Record<
  Exclude<ConvertErrorCode, "too_long" | "rate_limited" | "daily_limit">,
  { status: number; message: string }
> = {
  invalid_request: {
    status: 400,
    message: "Send the letter text as JSON in a field called original.",
  },
  empty: {
    status: 400,
    message: "There is no letter text. Paste or upload the letter first.",
  },
  too_large: {
    status: 413,
    message: "This request is too big. Letters can have up to 1,500 words.",
  },
  checker_unavailable: {
    status: 503,
    message: "The service that checks the Easy Read version isn't working right now. Try again in a few minutes.",
  },
  providers_unavailable: {
    status: 503,
    message: "The AI service is busy right now. Try again in a few minutes.",
  },
  model_output_invalid: {
    status: 502,
    message: "Converting the letter went wrong. Try again in a minute.",
  },
  access_required: ACCESS_ERRORS.access_required,
  access_closed: ACCESS_ERRORS.access_closed,
  internal: {
    status: 500,
    message: "Something went wrong. Try again in a minute.",
  },
};
