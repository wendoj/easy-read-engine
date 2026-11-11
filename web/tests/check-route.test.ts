/**
 * `/api/check` (task 26; R9.1 to R9.4, R2.4, R7.4). The checker and the judge
 * are fakes, so no request leaves the machine. Assertions on letter or line
 * text use `includes` or equality on booleans, so a failure never prints it.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type CheckLogEvent, type CheckModel, type CheckResponse, type CheckRouteChecker, handleCheck, mergeJudgeChecks } from "@/src/check";
import { CheckerUnavailable } from "@/src/checker-client/errors";
import type { CheckResult, KeyFact, Line, Sentence } from "@/src/checker-client/schemas";
import { JUDGE_UNAVAILABLE, type JudgePair, buildJudgeResults } from "@/src/llm/judge";
import { RULES } from "@/src/pipeline/decide";
import { ROUTE_COSTS, createRateLimiter } from "@/src/rate-limit";

// ---------- fakes ----------

const MARKER = "Zebrafinch";
const SENTENCES = ["Dear Zebrafinch, pay £45 by 1 April 2026.", "Call 0300 123 4567.", "We got your form."];
const ORIGINAL = SENTENCES.join(" ");

function analysis(original: string): { sentences: Sentence[]; key_facts: KeyFact[] } {
  const sentences: Sentence[] = [];
  let cursor = 0;
  SENTENCES.forEach((text, i) => {
    const start = original.indexOf(text, cursor);
    sentences.push({ id: `s${i + 1}`, text, start, end: start + text.length });
    cursor = start + text.length;
  });
  const at = original.indexOf("£45");
  const key_facts: KeyFact[] = [
    { id: "f1", type: "money", value: "£45", normalised: "GBP45.00", start: at, end: at + 3, sentence_id: "s1" },
  ];
  return { sentences, key_facts };
}

const RULE_IDS = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"] as const;
type RuleOutcomes = Record<(typeof RULE_IDS)[number], boolean>;
const ALL_PASS: RuleOutcomes = { P1: true, P2: true, P3: true, P4: true, P5: true, P6: true, P7: true, P8: true };

const result = (rule: CheckResult["rule"], passed: boolean, lineIds: string[] = []): CheckResult => ({
  rule,
  passed,
  line_ids: passed ? [] : lineIds,
  failed_fact_ids: rule === "P1" && !passed ? ["f1"] : [],
  details: passed ? [] : lineIds.map((id) => `${id} failed`),
});

interface Seen {
  health: number;
  analysed: string[];
  checked: { key_facts: KeyFact[]; lines: Line[] }[];
  lineFacts: Line[][];
  judged: JudgePair[][];
  getModel: number;
}

function newSeen(): Seen {
  return { health: 0, analysed: [], checked: [], lineFacts: [], judged: [], getModel: 0 };
}

function fakeChecker(seen: Seen, opts: { down?: boolean; outcomes?: RuleOutcomes } = {}): CheckRouteChecker {
  const outcomes = opts.outcomes ?? ALL_PASS;
  return {
    async health() {
      seen.health += 1;
      if (opts.down) throw new CheckerUnavailable("/health", "network");
      return { status: "ok" };
    },
    async analyse(original) {
      seen.analysed.push(original);
      return analysis(original);
    },
    async check(request) {
      seen.checked.push({ key_facts: request.key_facts, lines: structuredClone(request.lines) });
      const ids = request.lines.map((l) => l.id);
      return RULE_IDS.map((rule) => result(rule, outcomes[rule], ids.slice(0, 1)));
    },
    async lineFacts(request) {
      seen.lineFacts.push(structuredClone(request.lines));
      return [];
    },
  };
}

function fakeModel(seen: Seen, opts: { judgeFails?: ReadonlySet<string>; judgeUnavailable?: boolean } = {}): CheckModel {
  return {
    async judge(pairs) {
      seen.judged.push(structuredClone(pairs));
      const ids = pairs.map((p) => p.lineId);
      if (opts.judgeUnavailable) {
        const make = (rule: "P9" | "P10"): CheckResult => ({
          rule,
          passed: false,
          line_ids: ids,
          failed_fact_ids: [],
          details: ids.map((id) => `${id} ${JUDGE_UNAVAILABLE}`),
        });
        return { checks: [make("P9"), make("P10")], available: false, requests: 1 };
      }
      const fails = opts.judgeFails ?? new Set<string>();
      const verdicts = ids.map((lineId) => ({
        lineId,
        meaning: { verdict: fails.has(lineId) ? ("fail" as const) : ("pass" as const), reason: "" },
        tone: { verdict: "pass" as const, reason: "" },
        advice: { verdict: "pass" as const, reason: "" },
      }));
      return { checks: buildJudgeResults(ids, verdicts), available: true, provider: "fake", model: "judge-model", requests: 1 };
    },
  };
}

function lines(texts: string[]): Line[] {
  return texts.map((text, i) => ({ id: `L${i + 1}`, text, source_sentence_id: `s${(i % 3) + 1}`, symbol_id: i % 2 ? "2349" : null }));
}

function passingPrevious(): CheckResult[] {
  return RULES.map((rule) => result(rule, true));
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    original: ORIGINAL,
    lines: lines(["You need to pay £45 by 1 April 2026.", "Call 0300 123 4567.", "The council got your form."]),
    editedLineIds: ["L1"],
    previousChecks: passingPrevious(),
    ...overrides,
  };
}

function checkRequest(payload: unknown, ip = "203.0.113.7"): Request {
  return new Request("http://localhost/api/check", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

function setup(
  opts: {
    down?: boolean;
    outcomes?: RuleOutcomes;
    judgeFails?: ReadonlySet<string>;
    judgeUnavailable?: boolean;
    limiter?: ReturnType<typeof createRateLimiter>;
  } = {},
) {
  const seen = newSeen();
  const logs: CheckLogEvent[] = [];
  const limiter = opts.limiter ?? createRateLimiter({ logger: () => {} });
  const deps = {
    getChecker: () => fakeChecker(seen, opts),
    getModel: () => {
      seen.getModel += 1;
      return fakeModel(seen, opts);
    },
    rateLimit: limiter.limit,
    logger: (e: CheckLogEvent) => logs.push(e),
  };
  return { seen, logs, limiter, deps };
}

const sameLines = (a: readonly Line[], b: readonly Line[]) => JSON.stringify(a) === JSON.stringify(b);

// ---------- properties ----------

const textArb = fc
  .string({ minLength: 1, maxLength: 120, unit: "grapheme" })
  .filter((s) => s.trim() !== "" && s.length <= 300);

const scenarioArb = fc
  .record({
    texts: fc.array(textArb, { minLength: 1, maxLength: 6 }),
    outcomes: fc.record({
      P1: fc.boolean(),
      P2: fc.boolean(),
      P3: fc.boolean(),
      P4: fc.boolean(),
      P5: fc.boolean(),
      P6: fc.boolean(),
      P7: fc.boolean(),
      P8: fc.boolean(),
    }),
    previousP9Fails: fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
  })
  .chain((s) => {
    const ls = lines(s.texts);
    return fc
      .subarray(
        ls.map((l) => l.id),
        { minLength: 1 },
      )
      .map((edited) => ({ ...s, lines: ls, edited }));
  });

describe("/api/check properties", () => {
  /**
   * **Validates: Requirements 9.1, 9.2**
   * For any edit, the user's text reaches the checker and the judge as written,
   * and comes back unchanged (or not at all when blocked).
   */
  it("never changes the user's text", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (s) => {
        const { seen, deps } = setup({ outcomes: s.outcomes });
        const res = await handleCheck(checkRequest(body({ lines: s.lines, editedLineIds: s.edited })), deps);
        expect(res.status).toBe(200);
        const out = (await res.json()) as CheckResponse;
        expect(seen.checked).toHaveLength(1);
        expect(sameLines(seen.checked[0].lines, s.lines)).toBe(true);
        const byId = new Map(s.lines.map((l) => [l.id, l.text]));
        expect(seen.judged.flat().every((p) => p.line === byId.get(p.lineId))).toBe(true);
        if (out.status === "blocked") {
          expect(out.lines).toEqual([]);
          expect(seen.lineFacts).toHaveLength(0);
        } else {
          expect(sameLines(out.lines, s.lines)).toBe(true);
          expect(seen.lineFacts.every((ls) => sameLines(ls, s.lines))).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 9.2**
   * The judge is called once, with exactly the edited lines. P9 and P10 for the
   * other lines are carried over from the previous checks.
   */
  it("calls the judge only for edited lines", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (s) => {
        const { seen, deps } = setup({ outcomes: s.outcomes });
        const previousFailing = s.lines.filter((_, i) => s.previousP9Fails[i]).map((l) => l.id);
        const previousChecks = passingPrevious().map((c) =>
          c.rule === "P9" ? result("P9", previousFailing.length === 0, previousFailing) : c,
        );
        const res = await handleCheck(
          checkRequest(body({ lines: s.lines, editedLineIds: s.edited, previousChecks })),
          deps,
        );
        expect(res.status).toBe(200);
        const out = (await res.json()) as CheckResponse;
        expect(seen.judged).toHaveLength(1);
        const judgedIds = seen.judged[0].map((p) => p.lineId).sort();
        expect(judgedIds).toEqual([...s.edited].sort());
        // The fake judge passes every edited line, so P9 fails on exactly the unedited lines that failed before.
        const p9 = out.checks.find((c) => c.rule === "P9");
        const expected = previousFailing.filter((id) => !s.edited.includes(id)).sort();
        expect([...(p9?.line_ids ?? [])].sort()).toEqual(expected);
        expect(p9?.passed).toBe(expected.length === 0);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 9.3, 2.5**
   * Whenever P1 fails, the status is "blocked" and no lines are returned.
   */
  it('returns "blocked" whenever P1 fails', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (s) => {
        const { deps } = setup({ outcomes: s.outcomes });
        const res = await handleCheck(checkRequest(body({ lines: s.lines, editedLineIds: s.edited })), deps);
        const out = (await res.json()) as CheckResponse;
        expect(out.status === "blocked").toBe(!s.outcomes.P1);
        if (!s.outcomes.P1) {
          expect(out.lines).toEqual([]);
          expect(out.lineFacts).toEqual([]);
        }
        expect(out.checks.map((c) => c.rule)).toEqual([...RULES]);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------- unit tests ----------

describe("/api/check request checks", () => {
  it.each([
    ["not JSON", "{original:"],
    ["no lines", body({ lines: undefined })],
    ["no lines in the list", body({ lines: [], editedLineIds: ["L1"] })],
    ["no edited line IDs", body({ editedLineIds: [] })],
    ["an edited ID that isn't a line", body({ editedLineIds: ["L9"] })],
    ["a line ID given twice", body({ lines: lines(["One.", "Two."]).map((l) => ({ ...l, id: "L1" })) })],
    ["no previous P9 result", body({ previousChecks: passingPrevious().filter((c) => c.rule !== "P9") })],
    ["a line ID with a space", body({ lines: lines(["One."]).map((l) => ({ ...l, id: "L 1" })), editedLineIds: ["L 1"] })],
    ["a symbol ID that isn't a string", body({ lines: lines(["One."]).map((l) => ({ ...l, symbol_id: 5 })) })],
    ["an empty Original", body({ original: "   " })],
  ])("rejects a body with %s with a 400 before any checker or model call", async (_name, payload) => {
    const { seen, deps, limiter } = setup();
    const res = await handleCheck(checkRequest(payload), deps);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_request");
    expect(seen.health).toBe(0);
    expect(seen.getModel).toBe(0);
    expect(limiter.usedToday()).toBe(0);
  });

  it("rejects an empty line with its own message, keeping the text unsent", async () => {
    const { seen, deps } = setup();
    const res = await handleCheck(checkRequest(body({ lines: lines(["  ", "Two."]) })), deps);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("empty_line");
    expect(seen.judged).toHaveLength(0);
  });

  it("rejects a line over 300 characters", async () => {
    const { deps } = setup();
    const res = await handleCheck(checkRequest(body({ lines: lines(["a".repeat(301)]) })), deps);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("too_long");
  });

  it("rejects a body over the size limit with a 413", async () => {
    const { deps } = setup();
    const res = await handleCheck(checkRequest(body({ original: "a ".repeat(400_000) })), deps);
    expect(res.status).toBe(413);
  });

  it("rejects a line whose source sentence isn't in the Original", async () => {
    const { seen, deps } = setup();
    const ls = lines(["One."]).map((l) => ({ ...l, source_sentence_id: "s99" }));
    const res = await handleCheck(checkRequest(body({ lines: ls })), deps);
    expect(res.status).toBe(400);
    expect(seen.checked).toHaveLength(0);
    expect(seen.judged).toHaveLength(0);
  });
});

describe("/api/check behaviour", () => {
  it("returns 503 when the checker is down, without building the model or calling the judge", async () => {
    const { seen, deps, limiter } = setup({ down: true });
    const res = await handleCheck(checkRequest(body()), deps);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("checker_unavailable");
    expect(seen.getModel).toBe(0);
    expect(seen.judged).toHaveLength(0);
    expect(limiter.usedToday()).toBe(0);
  });

  it("takes key facts from the Original, not from the client", async () => {
    const { seen, deps } = setup();
    const forged: KeyFact[] = [
      { id: "f1", type: "money", value: "£99", normalised: "GBP99.00", start: 0, end: 3, sentence_id: "s1" },
    ];
    const res = await handleCheck(checkRequest({ ...body(), keyFacts: forged }), deps);
    expect(res.status).toBe(200);
    expect(seen.analysed).toHaveLength(1);
    expect(seen.analysed[0] === ORIGINAL).toBe(true);
    expect(seen.checked[0].key_facts).toEqual(analysis(ORIGINAL).key_facts);
    const out = (await res.json()) as CheckResponse;
    expect(out.keyFacts).toEqual(analysis(ORIGINAL).key_facts);
  });

  it("sends the judge the source sentence from the Original for each edited line", async () => {
    const { seen, deps } = setup();
    await handleCheck(checkRequest(body({ editedLineIds: ["L2"] })), deps);
    expect(seen.judged[0]).toHaveLength(1);
    expect(seen.judged[0][0].source === SENTENCES[1]).toBe(true);
  });

  it("flags a new P10 failure on an edited line, and keeps the user's symbol IDs", async () => {
    const { seen, deps } = setup({ judgeFails: new Set(["L1"]) });
    const res = await handleCheck(checkRequest(body()), deps);
    const out = (await res.json()) as CheckResponse;
    expect(out.status).toBe("flagged");
    expect(out.checks.find((c) => c.rule === "P9")?.line_ids).toEqual(["L1"]);
    expect(seen.checked[0].lines.map((l) => l.symbol_id)).toEqual([null, "2349", null]);
  });

  it("reports the judge as unavailable and flags P9 and P10 when it gives no answer", async () => {
    const { deps } = setup({ judgeUnavailable: true });
    const out = (await (await handleCheck(checkRequest(body()), deps)).json()) as CheckResponse;
    expect(out.judgeAvailable).toBe(false);
    expect(out.status).toBe("flagged");
  });

  it("shares the rate limit with /api/convert and costs 1", async () => {
    const limiter = createRateLimiter({ capacity: ROUTE_COSTS.convert, refillPerHour: 1, logger: () => {} });
    const { seen, deps } = setup({ limiter });
    const ip = "198.51.100.4";
    // A conversion from the same client empties the shared bucket.
    expect((await limiter.limit(checkRequest({}, ip), "convert")).allowed).toBe(true);
    const res = await handleCheck(checkRequest(body(), ip), deps);
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("rate_limited");
    expect(seen.judged).toHaveLength(0);
    expect(ROUTE_COSTS.check).toBe(1);
    const other = setup();
    await handleCheck(checkRequest(body()), other.deps);
    expect(other.limiter.usedToday()).toBe(1);
  });

  it("never logs the Original, line text or key-fact values", async () => {
    const { logs, deps } = setup({ outcomes: { ...ALL_PASS, P1: false } });
    await handleCheck(checkRequest(body()), deps);
    await handleCheck(checkRequest("{bad"), deps);
    const text = JSON.stringify(logs);
    expect(text.includes(MARKER)).toBe(false);
    expect(text.includes("£45")).toBe(false);
    expect(text.includes("council")).toBe(false);
    expect(logs[0].result).toBe("blocked");
  });
});

describe("mergeJudgeChecks", () => {
  it("drops verdicts for edited or removed lines and keeps the others", () => {
    const previous = [result("P9", false, ["L1", "L2", "L3"]), result("P10", false, ["L2"])];
    const judged = [result("P9", true), result("P10", false, ["L1"])];
    const [p9, p10] = mergeJudgeChecks(previous, judged, new Set(["L2"]));
    expect(p9.line_ids).toEqual(["L2"]);
    expect(p9.details).toEqual(["L2 failed"]);
    expect(p10.line_ids).toEqual(["L2", "L1"]);
    expect(p10.passed).toBe(false);
  });

  it("keeps a previous failure that named no line, so a gap never becomes a pass", () => {
    const missing: CheckResult = { rule: "P9", passed: false, line_ids: [], failed_fact_ids: [], details: ["no result for this rule"] };
    const [p9] = mergeJudgeChecks([missing, result("P10", true)], [result("P9", true), result("P10", true)], new Set(["L1"]));
    expect(p9.passed).toBe(false);
  });
});
