/**
 * Checker client errors. Messages hold only the route path, the HTTP status and
 * field locations or error types. Never letter text, line text, key-fact values
 * or the `/symbols` query (R7.4).
 */
import type { ValidationIssue } from "./schemas";

export type CheckerRoute = "/analyse" | "/key-facts" | "/check" | "/symbols" | "/health";

export type UnavailableReason = "network" | "timeout" | "server_error" | "invalid_response";

/**
 * The checker can't be used: network error, timeout, 5xx (including `/health`
 * reporting "starting") or a response that fails validation. Route handlers
 * return 503, so unchecked output is never shown.
 */
export class CheckerUnavailable extends Error {
  readonly route: CheckerRoute;
  readonly reason: UnavailableReason;
  readonly status: number | undefined;

  constructor(route: CheckerRoute, reason: UnavailableReason, status?: number) {
    super(`checker unavailable: ${reason} on ${route}${status === undefined ? "" : ` (status ${status})`}`);
    this.name = "CheckerUnavailable";
    this.route = route;
    this.reason = reason;
    this.status = status;
  }
}

/**
 * The checker rejected the request (4xx). `issues` holds field locations and
 * error types only, as returned by the checker's 422 handler.
 */
export class CheckerRequestError extends Error {
  readonly route: CheckerRoute;
  readonly status: number;
  readonly issues: ValidationIssue[];

  constructor(route: CheckerRoute, status: number, issues: ValidationIssue[]) {
    const summary = issues.map((i) => `${i.loc.join(".")}: ${i.type}`).join("; ");
    super(`checker rejected request on ${route} (status ${status})${summary ? `: ${summary}` : ""}`);
    this.name = "CheckerRequestError";
    this.route = route;
    this.status = status;
    this.issues = issues;
  }
}
