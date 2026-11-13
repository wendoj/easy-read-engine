/**
 * `/api/access`. GET returns the `AccessState`. POST `{ key }` sets the
 * `er_access` cookie on a match, and each try is rate limited to slow
 * guessing. DELETE clears the cookie. Never log the key or the cookie.
 */
import { z } from "zod";
import { NO_STORE, errorResponse as failureResponse, rateLimitFailure, readJson } from "@/src/http/response";
import { type RateLimiter, rateLimit as defaultRateLimit } from "@/src/rate-limit";
import { ACCESS_ERRORS, type AccessErrorCode, type AccessState, MAX_ACCESS_KEY_CHARS } from "./errors";
import {
  type AccessEnv,
  accessCookie,
  accessState,
  accessToken,
  keyMatches,
  stateWithoutCookie,
} from "./key";

export interface AccessHandlerDeps {
  env?: AccessEnv;
  rateLimit?: RateLimiter;
  logger?: (event: AccessLogEvent) => void;
}

/** Log event. No key, no cookie, no client address. */
export interface AccessLogEvent {
  msg: "access_request";
  method: "GET" | "POST" | "DELETE";
  outcome: AccessState | AccessErrorCode | "rate_limited" | "daily_limit" | "cleared";
  status: number;
}

/** Room for `{"key": ...}` with a 200-character key and JSON escapes. */
const MAX_ACCESS_BODY_BYTES = 4 * 1024;

const bodySchema = z.object({ key: z.string().min(1).max(MAX_ACCESS_KEY_CHARS) });


const defaultLogger = (event: AccessLogEvent) => console.info(JSON.stringify(event));

function errorResponse(code: AccessErrorCode): Response {
  return failureResponse({ error: code, ...ACCESS_ERRORS[code] });
}

export function handleAccessGet(request: Request, deps: AccessHandlerDeps = {}): Response {
  const access = accessState(request, deps.env ?? process.env);
  (deps.logger ?? defaultLogger)({ msg: "access_request", method: "GET", outcome: access, status: 200 });
  return Response.json({ access }, { headers: NO_STORE });
}

export async function handleAccessPost(request: Request, deps: AccessHandlerDeps = {}): Promise<Response> {
  const env = deps.env ?? process.env;
  const log = (outcome: AccessLogEvent["outcome"], status: number) =>
    (deps.logger ?? defaultLogger)({ msg: "access_request", method: "POST", outcome, status });

  const before = stateWithoutCookie(env);
  if (before === "closed") {
    log("access_closed", 503);
    return errorResponse("access_closed");
  }
  if (before === "open") {
    // Development with no key: nothing to check, and no cookie is needed.
    log("open", 200);
    return Response.json({ access: "open" }, { headers: NO_STORE });
  }

  // Charged before the key is read, so every attempt counts.
  const limit = await (deps.rateLimit ?? defaultRateLimit)(request, "access");
  if (!limit.allowed) {
    log(limit.code, limit.status);
    return failureResponse(rateLimitFailure(limit));
  }

  const read = await readJson(request, MAX_ACCESS_BODY_BYTES);
  // zod issues are not passed on: they could quote the key.
  const parsed = bodySchema.safeParse(read.ok ? read.json : null);
  if (!parsed.success) {
    log("invalid_request", 400);
    return errorResponse("invalid_request");
  }

  if (!keyMatches(parsed.data.key, env)) {
    log("wrong_key", 401);
    return errorResponse("wrong_key");
  }

  log("granted", 200);
  return Response.json(
    { access: "granted" },
    { headers: { ...NO_STORE, "set-cookie": accessCookie(accessToken(env.ACCESS_KEY ?? ""), env) } },
  );
}

export function handleAccessDelete(_request: Request, deps: AccessHandlerDeps = {}): Response {
  const env = deps.env ?? process.env;
  (deps.logger ?? defaultLogger)({ msg: "access_request", method: "DELETE", outcome: "cleared", status: 200 });
  return Response.json(
    { access: stateWithoutCookie(env) },
    { headers: { ...NO_STORE, "set-cookie": accessCookie("", env) } },
  );
}
