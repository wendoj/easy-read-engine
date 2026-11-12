/**
 * Error codes, statuses and messages for judge access (`/api/access`, and the
 * access check on `/api/convert`, `/api/extract` and `/api/check`). Messages
 * are fixed text and never include the submitted key. No server imports, so
 * client code can use the table too.
 */
export type AccessErrorCode = "access_required" | "access_closed" | "wrong_key" | "invalid_request";

/** "open": development with no key. "closed": production with no key. */
export type AccessState = "open" | "granted" | "denied" | "closed";

/** The 2 codes a model route returns when the visitor has no access. */
export type AccessDenialCode = "access_required" | "access_closed";

export const ACCESS_REQUIRED_MESSAGE =
  "Live conversion is open to hackathon judges only. You can still read the sample letters.";
export const ACCESS_CLOSED_MESSAGE = "Live conversion is turned off right now. You can still read the sample letters.";

export const ACCESS_ERRORS: Record<AccessErrorCode, { status: number; message: string }> = {
  access_required: { status: 401, message: ACCESS_REQUIRED_MESSAGE },
  access_closed: { status: 503, message: ACCESS_CLOSED_MESSAGE },
  wrong_key: { status: 401, message: "That access key is not right." },
  invalid_request: { status: 400, message: "Type the access key." },
};

/** Longest key accepted by `POST /api/access`. */
export const MAX_ACCESS_KEY_CHARS = 200;
