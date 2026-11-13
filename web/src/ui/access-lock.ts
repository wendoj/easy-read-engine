/**
 * Access state is null until `GET /api/access` answers or when it can't be
 * reached. Screens then keep their controls on: every model route checks access again.
 */
import type { AccessState } from "@/src/access/errors";

export function isLocked(access: AccessState | null): access is "denied" | "closed" {
  return access === "denied" || access === "closed";
}

/** `access_required` (401) means a missing or revoked key; `access_closed` (503) means no key is set. */
export function accessAfterError(error: string | null): AccessState | null {
  if (error === "access_required") return "denied";
  if (error === "access_closed") return "closed";
  return null;
}
