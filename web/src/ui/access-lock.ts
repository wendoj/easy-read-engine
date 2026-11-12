/**
 * Judge access on the input and result screens. Pure, so it can be tested
 * without a browser.
 *
 * The access state comes from `GET /api/access`. It is null until that
 * answers, or when it can't be reached: the screens then keep their controls
 * on, because every model route checks access again on the server.
 */
import type { AccessState } from "@/src/access/errors";

/** True when this browser can't use the model routes (no key, or live conversion turned off). */
export function isLocked(access: AccessState | null): access is "denied" | "closed" {
  return access === "denied" || access === "closed";
}

/**
 * The access state a model route's error code shows, or null when the error
 * is not about access. A 401 `access_required` means the key is missing or old
 * (the cookie was revoked), and a 503 `access_closed` means no key is set.
 */
export function accessAfterError(error: string | null): AccessState | null {
  if (error === "access_required") return "denied";
  if (error === "access_closed") return "closed";
  return null;
}
