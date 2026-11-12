/**
 * Judge access key (design "Protecting the live quota").
 *
 * The routes that call a model need a secret key, set in `ACCESS_KEY`.
 * Hackathon judges get it through the private Devpost form. Samples
 * (`/api/sample`) and PDF export (`/api/export`) make no model call and stay
 * open to everyone.
 *
 * - `ACCESS_KEY` set: a model route needs a valid `er_access` cookie.
 * - `ACCESS_KEY` empty in production: model routes are closed to everyone
 *   (fail closed). Any `APP_ENV` other than "development" counts as production.
 * - `ACCESS_KEY` empty in development: model routes stay open, so local runs
 *   and tests work without a key.
 *
 * The cookie holds HMAC-SHA256(ACCESS_KEY, a fixed label) in base64url, so
 * the browser never stores the key itself, and changing `ACCESS_KEY` revokes
 * every cookie. Comparisons are timing-safe. The key and the cookie are never
 * logged.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { ACCESS_ERRORS, type AccessDenialCode, type AccessState } from "./errors";

export const ACCESS_COOKIE = "er_access";
/** 30 days. */
export const ACCESS_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const TOKEN_LABEL = "easy-read-access-v1";

export type AccessEnv = Record<string, string | undefined>;

export interface AccessDenial {
  error: AccessDenialCode;
  status: number;
  message: string;
}

/** Returns null when the request may go on, or the denial to send. Injectable in tests. */
export type AccessGate = (request: Request) => AccessDenial | null;

/** The cookie value for a key. */
export function accessToken(key: string): string {
  return createHmac("sha256", key).update(TOKEN_LABEL).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

function configuredKey(env: AccessEnv): string | null {
  const key = env.ACCESS_KEY ?? "";
  return key.trim() === "" ? null : key;
}

export function isProduction(env: AccessEnv): boolean {
  return (env.APP_ENV ?? "development") !== "development";
}

/** The value of 1 cookie from a `Cookie` header, or null. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** The access state when no cookie is sent. */
export function stateWithoutCookie(env: AccessEnv = process.env): AccessState {
  if (configuredKey(env) === null) return isProduction(env) ? "closed" : "open";
  return "denied";
}

export function accessState(request: Request, env: AccessEnv = process.env): AccessState {
  // The cookie is read first, so a GET handler calling this always reads
  // request data and is never prerendered with a fixed answer.
  const cookie = readCookie(request.headers.get("cookie"), ACCESS_COOKIE);
  const key = configuredKey(env);
  if (key === null) return isProduction(env) ? "closed" : "open";
  return cookie !== null && safeEqual(cookie, accessToken(key)) ? "granted" : "denied";
}

/** True when `submitted` is the configured key. Compares HMACs, so lengths always match. */
export function keyMatches(submitted: string, env: AccessEnv = process.env): boolean {
  const key = configuredKey(env);
  if (key === null) return false;
  return safeEqual(accessToken(submitted), accessToken(key));
}

/** The access check for a model route. */
export function checkAccess(request: Request, env: AccessEnv = process.env): AccessDenial | null {
  const state = accessState(request, env);
  if (state === "open" || state === "granted") return null;
  const error = state === "closed" ? "access_closed" : "access_required";
  return { error, ...ACCESS_ERRORS[error] };
}

/** The default gate, reading `process.env` on each request. */
export const requireAccess: AccessGate = (request) => checkAccess(request);

/** A `Set-Cookie` value. Secure in production. An empty token clears the cookie. */
export function accessCookie(token: string, env: AccessEnv = process.env): string {
  const maxAge = token === "" ? 0 : ACCESS_COOKIE_MAX_AGE_SECONDS;
  const parts = [`${ACCESS_COOKIE}=${token}`, "HttpOnly", "SameSite=Strict", "Path=/", `Max-Age=${maxAge}`];
  if (isProduction(env)) parts.push("Secure");
  return parts.join("; ");
}
