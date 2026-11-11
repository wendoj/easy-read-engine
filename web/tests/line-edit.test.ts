/**
 * Client edit logic (task 26; R9.1 to R9.3, R7.4): the edit, the `/api/check`
 * body, merging the response and "Undo edit".
 */
import { describe, expect, it } from "vitest";
import type { CheckResult, Line } from "@/src/checker-client/schemas";
import { NOTICE, RULES } from "@/src/pipeline/decide";
import type { ConversionResult } from "@/src/pipeline/types";
import { checkEdit } from "@/src/ui/api";
import {
  type CheckResponseBody,
  EMPTY_HISTORY,
  MAX_UNDO,
  applyCheckResponse,
  buildCheckRequest,
  canUndo,
  editLine,
  editProblem,
  recordEdit,
  undoEdit,
} from "@/src/ui/line-edit";

const pass = (rule: CheckResult["rule"]): CheckResult => ({ rule, passed: true, line_ids: [], failed_fact_ids: [], details: [] });

const LINES: Line[] = [
  { id: "L1", text: "You need to pay £45.", source_sentence_id: "s1", symbol_id: "2349" },
  { id: "L2", text: "The council got your form.", source_sentence_id: "s2", symbol_id: null },
];

function makeResult(overrides: Partial<ConversionResult> = {}): ConversionResult {
  return {
    status: "passed",
    original: { text: "Pay £45. We got your form.", sentences: [] },
    keyFacts: [],
    lines: LINES,
    checks: RULES.map(pass),
    attempts: 1,
    notice: NOTICE,
    judgeAvailable: true,
    models: [{ task: "rewrite", attempt: 1, provider: "fake", model: "m" }],
    actionSynonyms: [],
    lineFacts: [],
    ...overrides,
  };
}

function response(overrides: Partial<CheckResponseBody> = {}): CheckResponseBody {
  return {
    status: "passed",
    checks: RULES.map(pass),
    lines: editLine(LINES, "L1", "You must pay £45."),
    lineFacts: [{ line_id: "L1", fact_id: "f1", start: 13, end: 16 }],
    sentences: [{ id: "s1", text: "Pay £45.", start: 0, end: 8 }],
    keyFacts: [],
    judgeAvailable: true,
    models: [{ task: "judge", attempt: 1, provider: "fake", model: "j" }],
    ...overrides,
  };
}

describe("editLine and editProblem", () => {
  it("changes only the text of the edited line", () => {
    const out = editLine(LINES, "L1", "You must pay £45.");
    expect(out[0]).toEqual({ ...LINES[0], text: "You must pay £45." });
    expect(out[1]).toEqual(LINES[1]);
    expect(LINES[0].text).toBe("You need to pay £45.");
  });

  it("stops empty, too long and unchanged drafts before any request", () => {
    expect(editProblem(LINES, "L1", "  ")).toBe("empty");
    expect(editProblem(LINES, "L1", "a".repeat(301))).toBe("too_long");
    expect(editProblem(LINES, "L1", LINES[0].text)).toBe("unchanged");
    expect(editProblem(LINES, "L9", "Text.")).toBe("no_line");
    expect(editProblem(LINES, "L1", "You must pay £45.")).toBeNull();
  });
});

describe("buildCheckRequest", () => {
  it("sends the Original, every line with the edit, the edited ID and the current checks", () => {
    const r = makeResult();
    const body = buildCheckRequest(r, "L2", "The council has your form.");
    expect(body.original).toBe(r.original.text);
    expect(body.lines.map((l) => l.text)).toEqual(["You need to pay £45.", "The council has your form."]);
    expect(body.editedLineIds).toEqual(["L2"]);
    expect(body.previousChecks).toBe(r.checks);
    expect(Object.keys(body).sort()).toEqual(["editedLineIds", "lines", "original", "previousChecks"]);
  });
});

describe("applyCheckResponse", () => {
  it("takes the status, checks, lines, line facts and key facts from the response and keeps the Original", () => {
    const before = makeResult();
    const after = applyCheckResponse(before, response({ status: "flagged" }));
    expect(after.status).toBe("flagged");
    expect(after.lines[0].text).toBe("You must pay £45.");
    expect(after.lineFacts).toHaveLength(1);
    expect(after.original.text).toBe(before.original.text);
    expect(after.original.sentences).toHaveLength(1);
    expect(after.notice).toBe(NOTICE);
    expect(after.models.map((m) => m.task)).toEqual(["rewrite", "judge"]);
  });

  it("holds no lines when the edit is blocked", () => {
    const after = applyCheckResponse(makeResult(), response({ status: "blocked", lines: LINES }));
    expect(after.status).toBe("blocked");
    expect(after.lines).toEqual([]);
    expect(after.lineFacts).toEqual([]);
  });
});

describe("Undo edit", () => {
  it("restores the result before each edit exactly, newest first", () => {
    const r0 = makeResult();
    const r1 = applyCheckResponse(r0, response());
    const r2 = applyCheckResponse(r1, response({ status: "blocked" }));
    let h = recordEdit(EMPTY_HISTORY, r0, r1);
    h = recordEdit(h, r1, r2);
    expect(canUndo(h, r2)).toBe(true);
    const u1 = undoEdit(h, r2);
    expect(u1?.result).toBe(r1);
    const u2 = undoEdit(u1!.history, u1!.result);
    expect(u2?.result).toBe(r0);
    expect(undoEdit(u2!.history, u2!.result)).toBeNull();
  });

  it("doesn't apply once the shown result was replaced some other way", () => {
    const r0 = makeResult();
    const r1 = applyCheckResponse(r0, response());
    const h = recordEdit(EMPTY_HISTORY, r0, r1);
    expect(canUndo(h, makeResult())).toBe(false);
    expect(undoEdit(h, null)).toBeNull();
    // An edit on a new result starts a new history.
    const other = makeResult();
    const next = recordEdit(h, other, r1);
    expect(next.past).toEqual([other]);
  });

  it(`keeps at most ${MAX_UNDO} results`, () => {
    let h = EMPTY_HISTORY;
    let shown = makeResult();
    for (let i = 0; i < MAX_UNDO + 5; i++) {
      const next = makeResult();
      h = recordEdit(h, shown, next);
      shown = next;
    }
    expect(h.past).toHaveLength(MAX_UNDO);
  });
});

describe("checkEdit", () => {
  const fakeFetch = (status: number, json: unknown) => async () =>
    new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });

  it("returns the parsed response on 200", async () => {
    const out = await checkEdit(buildCheckRequest(makeResult(), "L1", "You must pay £45."), {
      fetch: fakeFetch(200, response()),
    });
    expect(out.ok).toBe(true);
  });

  it.each([
    [429, { error: "rate_limited", message: "You have sent a lot of requests in a short time. Try again in 2 minutes." }, "2 minutes"],
    [503, { error: "checker_unavailable", message: "x" }, "isn't working right now"],
    [400, { error: "empty_line", message: "x" }, "can't be empty"],
    [502, "<html>", "Something went wrong"],
  ])("shows the route's message for a %s", async (status, json, expected) => {
    const out = await checkEdit(buildCheckRequest(makeResult(), "L1", "Text."), { fetch: fakeFetch(status, json) });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message.includes(expected)).toBe(true);
  });

  it("treats a 200 body that isn't a check response as an error", async () => {
    const out = await checkEdit(buildCheckRequest(makeResult(), "L1", "Text."), { fetch: fakeFetch(200, { status: "passed" }) });
    expect(out.ok).toBe(false);
  });
});
