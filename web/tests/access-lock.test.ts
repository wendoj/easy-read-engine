/**
 * Judge access on the input and result screens (`src/ui/access-lock.ts` and
 * the browser calls in `src/ui/api.ts`). The screens use these to lock paste,
 * upload and convert, to turn an access error from a model route into the
 * locked state, and to hide "Change this line" on the result screen. Vitest
 * runs in Node with no DOM, so the logic is tested here, not the components.
 */
import { describe, expect, it } from "vitest";
import { ACCESS_ERRORS, type AccessState } from "@/src/access/errors";
import { CHECK_ERRORS } from "@/src/check/errors";
import { CONVERT_ERRORS } from "@/src/convert/errors";
import { EXTRACT_ERRORS } from "@/src/extract/errors";
import { accessAfterError, isLocked } from "@/src/ui/access-lock";
import { checkEdit, convertLetter, extractText, getAccess, sendAccessKey } from "@/src/ui/api";
import type { CheckRequestBody } from "@/src/ui/line-edit";

const STATES: AccessState[] = ["open", "granted", "denied", "closed"];

function jsonFetch(status: number, body: unknown, seen: Request[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(new URL(String(input), "http://localhost"), init));
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("isLocked", () => {
  it("locks only denied and closed, and leaves the controls on while the state is unknown", () => {
    expect(STATES.filter(isLocked)).toEqual(["denied", "closed"]);
    expect(isLocked(null)).toBe(false);
  });
});

describe("accessAfterError", () => {
  it("turns the 2 access codes into the locked states", () => {
    expect(accessAfterError("access_required")).toBe("denied");
    expect(accessAfterError("access_closed")).toBe("closed");
  });

  it("ignores every other error, so other failures show their own message", () => {
    const others = new Set([
      ...Object.keys(CONVERT_ERRORS),
      ...Object.keys(EXTRACT_ERRORS),
      ...Object.keys(CHECK_ERRORS),
      "wrong_key",
      "invalid_request",
    ]);
    others.delete("access_required");
    others.delete("access_closed");
    for (const code of others) expect(accessAfterError(code)).toBeNull();
    expect(accessAfterError(null)).toBeNull();
  });
});

describe("model route answers that lock the screen", () => {
  it("a 401 from /api/convert locks the input screen as denied", async () => {
    const outcome = await convertLetter("You owe £45.", {
      fetch: jsonFetch(401, { error: "access_required", message: ACCESS_ERRORS.access_required.message }),
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(accessAfterError(outcome.error)).toBe("denied");
  });

  it("a 503 access_closed from /api/extract locks the input screen as closed", async () => {
    const file = new File([new Uint8Array([37, 80, 68, 70])], "letter.pdf", { type: "application/pdf" });
    const outcome = await extractText(file, {
      fetch: jsonFetch(503, { error: "access_closed", message: ACCESS_ERRORS.access_closed.message }),
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(accessAfterError(outcome.error)).toBe("closed");
  });

  it("a 401 from /api/check gives the edit message and hides Edit on the result screen", async () => {
    const body = { lines: [] } as unknown as CheckRequestBody;
    const outcome = await checkEdit(body, {
      fetch: jsonFetch(401, { error: "access_required", message: CHECK_ERRORS.access_required.message }),
    });
    expect(outcome).toEqual({ ok: false, error: "access_required", message: CHECK_ERRORS.access_required.message });
    if (outcome.ok) return;
    expect(isLocked(accessAfterError(outcome.error))).toBe(true);
  });

  it("a busy checker (503 checker_unavailable) does not lock anything", async () => {
    const outcome = await convertLetter("You owe £45.", {
      fetch: jsonFetch(503, { error: "checker_unavailable", message: "x" }),
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(accessAfterError(outcome.error)).toBeNull();
  });
});

describe("getAccess and sendAccessKey", () => {
  it("read every access state from GET /api/access", async () => {
    for (const access of STATES) {
      const seen: Request[] = [];
      expect(await getAccess({ fetch: jsonFetch(200, { access }, seen) })).toEqual({ ok: true, access });
      expect(seen[0].method).toBe("GET");
      expect(new URL(seen[0].url).pathname).toBe("/api/access");
    }
  });

  it("treat a bad GET answer as unknown, so the screen stays unlocked", async () => {
    const outcome = await getAccess({ fetch: jsonFetch(200, { access: "maybe" }) });
    expect(outcome.ok).toBe(false);
  });

  it("post the key once and unlock on a match", async () => {
    const seen: Request[] = [];
    const outcome = await sendAccessKey("judge-key", { fetch: jsonFetch(200, { access: "granted" }, seen) });
    expect(outcome).toEqual({ ok: true, access: "granted" });
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("POST");
    expect(await seen[0].json()).toEqual({ key: "judge-key" });
    expect(isLocked(outcome.ok ? outcome.access : null)).toBe(false);
  });

  it("show the wrong-key message and stay locked on a mismatch", async () => {
    const outcome = await sendAccessKey("nope", {
      fetch: jsonFetch(401, { error: "wrong_key", message: ACCESS_ERRORS.wrong_key.message }),
    });
    expect(outcome).toEqual({ ok: false, error: "wrong_key", message: ACCESS_ERRORS.wrong_key.message });
  });

  it("report a network failure without throwing", async () => {
    const failing = (async () => {
      throw new TypeError("offline");
    }) as typeof fetch;
    expect((await getAccess({ fetch: failing })).ok).toBe(false);
    expect((await sendAccessKey("k", { fetch: failing })).ok).toBe(false);
  });
});
