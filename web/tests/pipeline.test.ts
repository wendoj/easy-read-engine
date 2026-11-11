import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { CheckResult, KeyFact, Line, Sentence } from "@/src/checker-client/schemas";
import { CheckerUnavailable } from "@/src/checker-client";
import {
  type DraftLine,
  type JudgePair,
  type JudgeResult,
  type RegenerateInput,
  type RegenerateResult,
  JUDGE_UNAVAILABLE,
  buildJudgeResults,
  judgeUnavailableResults,
} from "@/src/llm";
import {
  type ConversionResult,
  type PipelineChecker,
  type PipelineLogEvent,
  type PipelineModel,
  type ProgressEvent,
  type Rule,
  LineIds,
  MAX_ATTEMPTS,
  NOTICE,
  RULES,
  applyRegeneration,
  convert,
  decide,
  failingLineIds,
  missingFacts,
} from "@/src/pipeline";

// --- scripted fakes ---------------------------------------------------------------
// The fake checker and fake model answer from a plan per try, so the tests cover
// only the orchestration. Picks are indices taken modulo the current line count.

const CHECKER_RULES = ["P2", "P3", "P4", "P5", "P6", "P7", "P8"] as const;

interface FactFailure {
  fact: number;
  /** Changed value on a picked line, instead of missing. */
  changed: boolean;
  pick: number;
}

interface TryPlan {
  p1: FactFailure[];
  rules: Partial<Record<(typeof CHECKER_RULES)[number], number[]>>;
  judgeAvailable: boolean;
  p9: number[];
  p10: number[];
}

interface Scenario {
  sentences: Sentence[];
  keyFacts: KeyFact[];
  drafts: DraftLine[];
  plans: TryPlan[];
  /** Number of replacement lines per failing line, used in turn. */
  splits: number[];
}

function pickIds(lines: readonly Line[], picks: readonly number[]): string[] {
  if (lines.length === 0) return [];
  const ids = new Set(picks.map((p) => lines[p % lines.length].id));
  return lines.filter((l) => ids.has(l.id)).map((l) => l.id);
}

/** P1 the way the real checker reports it (checker/src/checks/p1_key_facts.py). */
function fakeP1(plan: TryPlan, keyFacts: readonly KeyFact[], lines: readonly Line[]): CheckResult {
  const result: CheckResult = { rule: "P1", passed: true, line_ids: [], failed_fact_ids: [], details: [] };
  if (keyFacts.length === 0) return result;
  const ids = new Set<string>();
  for (const f of plan.p1) {
    const fact = keyFacts[f.fact % keyFacts.length];
    if (result.failed_fact_ids.includes(fact.id)) continue;
    result.failed_fact_ids.push(fact.id);
    if (f.changed && lines.length > 0) {
      ids.add(lines[f.pick % lines.length].id);
      result.details.push(`${fact.id} (${fact.type}) has a different value in the output`);
    } else {
      for (const l of lines) if (l.source_sentence_id === fact.sentence_id) ids.add(l.id);
      result.details.push(`${fact.id} (${fact.type}) is missing from the output`);
    }
  }
  result.passed = result.failed_fact_ids.length === 0;
  result.line_ids = lines.filter((l) => ids.has(l.id)).map((l) => l.id);
  return result;
}

interface Recorder {
  checked: Line[][];
  checkResults: CheckResult[][];
  judged: JudgeResult[];
  regenerateInputs: RegenerateInput[];
  modelCalls: { rewrite: number; regenerate: number; judge: number };
}

function fakes(s: Scenario, opts: { failCheckOn?: number; failAnalyse?: boolean } = {}) {
  const rec: Recorder = {
    checked: [],
    checkResults: [],
    judged: [],
    regenerateInputs: [],
    modelCalls: { rewrite: 0, regenerate: 0, judge: 0 },
  };
  const planFor = (i: number) => s.plans[Math.min(i, s.plans.length - 1)];

  const checker: PipelineChecker = {
    async analyse() {
      if (opts.failAnalyse) throw new CheckerUnavailable("/analyse", "network");
      return { sentences: s.sentences, key_facts: s.keyFacts };
    },
    async check({ lines }) {
      const i = rec.checked.length;
      if (opts.failCheckOn === i + 1) throw new CheckerUnavailable("/check", "timeout");
      rec.checked.push(lines.map((l) => ({ ...l })));
      const plan = planFor(i);
      const results: CheckResult[] = [fakeP1(plan, s.keyFacts, lines)];
      for (const rule of CHECKER_RULES) {
        const ids = pickIds(lines, plan.rules[rule] ?? []);
        results.push({
          rule,
          passed: ids.length === 0,
          line_ids: ids,
          failed_fact_ids: [],
          details: ids.map((id) => `${id} fails ${rule}`),
        });
      }
      rec.checkResults.push(results);
      return results;
    },
    async symbols() {
      return [];
    },
  };

  let splitAt = 0;
  const model: PipelineModel = {
    async rewrite() {
      rec.modelCalls.rewrite += 1;
      return { lines: s.drafts, provider: "fake", model: "rewrite-model", requests: 1 };
    },
    async regenerate(input): Promise<RegenerateResult> {
      rec.modelCalls.regenerate += 1;
      rec.regenerateInputs.push(input);
      const call = rec.modelCalls.regenerate;
      const replacements = input.failing.map(({ line }) => {
        const n = s.splits[splitAt++ % s.splits.length];
        return {
          lineId: line.id,
          lines: Array.from({ length: n }, (_, j) => ({
            text: `${line.text} zqr${call}x${j}`,
            sourceSentenceId: line.source_sentence_id,
            symbolQuery: "",
          })),
        };
      });
      const added = (input.missingFacts ?? []).map((f) => ({
        text: `zqadded ${f.id}`,
        sourceSentenceId: f.sentence_id,
        symbolQuery: "",
      }));
      return { replacements, added, provider: "fake", model: "rewrite-model", requests: 1 };
    },
    async judge(pairs: JudgePair[]): Promise<JudgeResult> {
      rec.modelCalls.judge += 1;
      const plan = planFor(rec.judged.length);
      const ids = pairs.map((p) => p.lineId);
      let result: JudgeResult;
      if (!plan.judgeAvailable) {
        result = { checks: judgeUnavailableResults(ids), available: false, requests: 2 };
      } else {
        const asLines = ids.map((id) => ({ id }) as Line);
        const p9 = new Set(pickIds(asLines, plan.p9));
        const p10 = new Set(pickIds(asLines, plan.p10));
        const pass = { verdict: "pass" as const, reason: "" };
        const fail = { verdict: "fail" as const, reason: "zqreason" };
        const verdicts = ids.map((lineId) => ({
          lineId,
          meaning: p9.has(lineId) ? fail : pass,
          tone: pass,
          advice: p10.has(lineId) ? fail : pass,
        }));
        result = { checks: buildJudgeResults(ids, verdicts), available: true, provider: "fake", model: "judge-model", requests: 1 };
      }
      rec.judged.push(result);
      return result;
    },
  };
  return { checker, model, rec };
}

// --- generators -------------------------------------------------------------------

const word = fc.stringMatching(/^[a-z]{6,10}$/).map((w) => `zq${w}`);
const picks = fc.array(fc.nat({ max: 20 }), { maxLength: 2 });
const rarePicks = fc.oneof({ weight: 3, arbitrary: fc.constant<number[]>([]) }, { weight: 1, arbitrary: picks });

const tryPlan: fc.Arbitrary<TryPlan> = fc.record({
  p1: fc.oneof(
    { weight: 2, arbitrary: fc.constant<FactFailure[]>([]) },
    { weight: 1, arbitrary: fc.array(fc.record({ fact: fc.nat({ max: 10 }), changed: fc.boolean(), pick: fc.nat({ max: 20 }) }), { minLength: 1, maxLength: 2 }) },
  ),
  rules: fc.record(
    Object.fromEntries(CHECKER_RULES.map((r) => [r, rarePicks])) as Record<(typeof CHECKER_RULES)[number], fc.Arbitrary<number[]>>,
    { requiredKeys: [] },
  ),
  judgeAvailable: fc.oneof({ weight: 4, arbitrary: fc.constant(true) }, { weight: 1, arbitrary: fc.constant(false) }),
  p9: rarePicks,
  p10: rarePicks,
});

const scenario: fc.Arbitrary<Scenario> = fc
  .record({
    sentenceTexts: fc.array(word, { minLength: 1, maxLength: 5 }),
    factPicks: fc.array(fc.record({ s: fc.nat({ max: 10 }), value: word }), { maxLength: 4 }),
    draftPicks: fc.array(fc.record({ s: fc.nat({ max: 10 }), text: word }), { minLength: 1, maxLength: 7 }),
    plans: fc.array(tryPlan, { minLength: 1, maxLength: 3 }),
    splits: fc.array(fc.integer({ min: 1, max: 2 }), { minLength: 1, maxLength: 4 }),
  })
  .map(({ sentenceTexts, factPicks, draftPicks, plans, splits }) => {
    let offset = 0;
    const sentences: Sentence[] = sentenceTexts.map((text, i) => {
      const s = { id: `s${i + 1}`, text, start: offset, end: offset + text.length };
      offset += text.length + 1;
      return s;
    });
    const keyFacts: KeyFact[] = factPicks.map((f, i) => ({
      id: `f${i + 1}`,
      type: "date",
      value: f.value,
      normalised: f.value,
      start: 0,
      end: f.value.length,
      sentence_id: sentences[f.s % sentences.length].id,
    }));
    const drafts: DraftLine[] = draftPicks.map((d) => ({
      text: d.text,
      sourceSentenceId: sentences[d.s % sentences.length].id,
      symbolQuery: "",
    }));
    return { sentences, keyFacts, drafts, plans, splits };
  });

const originalOf = (s: Scenario) => s.sentences.map((x) => x.text).join(" ");

async function run(s: Scenario) {
  const f = fakes(s);
  const logs: PipelineLogEvent[] = [];
  const events: ProgressEvent[] = [];
  const result = await convert(originalOf(s), {
    checker: f.checker,
    model: f.model,
    logger: (e) => logs.push(e),
    onProgress: (e) => events.push(e),
  });
  return { result, logs, events, rec: f.rec };
}

/** Rule results the fakes gave on the last try. */
function lastTry(rec: Recorder): CheckResult[] {
  return [...rec.checkResults[rec.checkResults.length - 1], ...rec.judged[rec.judged.length - 1].checks];
}

const RUNS = { numRuns: 300 };

// --- properties -------------------------------------------------------------------

describe("convert: fast-check properties", () => {
  it("makes no more than 3 tries", async () => {
    // **Validates: Requirements 3.3**
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        const { result, rec } = await run(s);
        expect(result.attempts).toBeGreaterThanOrEqual(1);
        expect(result.attempts).toBeLessThanOrEqual(MAX_ATTEMPTS);
        expect(rec.checked.length).toBe(result.attempts);
        expect(rec.modelCalls.judge).toBe(result.attempts);
      }),
      RUNS,
    );
  });

  it("P1 failing on the last try gives blocked and no lines", async () => {
    // **Validates: Requirements 2.4, 2.5, 3.5**
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        const { result, rec } = await run(s);
        const p1 = lastTry(rec).find((c) => c.rule === "P1")!;
        if (!p1.passed) {
          expect(result.status).toBe("blocked");
          expect(result.lines).toEqual([]);
        }
        if (result.status === "blocked") expect(p1.passed).toBe(false);
      }),
      RUNS,
    );
  });

  it("other rules failing on the last try give flagged, with every failed rule in checks", async () => {
    // **Validates: Requirements 3.4, 3.6, 6.1**
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        const { result, rec } = await run(s);
        const last = lastTry(rec);
        const failed = last.filter((c) => !c.passed).map((c) => c.rule);
        for (const rule of failed) {
          expect(result.checks.find((c) => c.rule === rule)?.passed).toBe(false);
        }
        if (failed.length > 0 && !failed.includes("P1")) {
          expect(result.status).toBe("flagged");
          expect(result.lines).toEqual(rec.checked[rec.checked.length - 1]);
        }
        if (failed.length === 0) expect(result.status).toBe("passed");
      }),
      RUNS,
    );
  });

  it("regeneration changes only failing lines", async () => {
    // **Validates: Requirements 3.3**
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        const { rec } = await run(s);
        for (let k = 0; k + 1 < rec.checked.length; k++) {
          const before = rec.checked[k];
          const after = rec.checked[k + 1];
          const judgeAvailable = rec.judged[k].available;
          const checks = [...rec.checkResults[k], ...rec.judged[k].checks];
          // Lines the fakes failed, not counting "judge unavailable".
          const expected = new Set(failingLineIds(checks, { lines: before, keyFacts: s.keyFacts, judgeAvailable }));
          const sent = new Set(rec.regenerateInputs[k].failing.map((f) => f.line.id));
          expect(sent).toEqual(expected);
          // Every other line keeps its ID, text and source, in the same order.
          const kept = before.filter((l) => !sent.has(l.id));
          const survivors = after.filter((l) => kept.some((x) => x.id === l.id));
          expect(survivors).toEqual(kept);
        }
      }),
      RUNS,
    );
  });

  it("checks always hold all 10 rules, and every result has the notice", async () => {
    // **Validates: Requirements 6.1, 7.1**
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        const { result } = await run(s);
        expect(result.checks.map((c) => c.rule)).toEqual(RULES);
        expect(result.notice).toBe(NOTICE);
      }),
      RUNS,
    );
  });

  it("makes at most 6 model requests", async () => {
    // **Validates: Requirements 3.3** (design "Testing Strategy": 3 tries of 2)
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        const { rec } = await run(s);
        const { rewrite, regenerate, judge } = rec.modelCalls;
        expect(rewrite).toBe(1);
        expect(regenerate).toBeLessThanOrEqual(MAX_ATTEMPTS - 1);
        expect(rewrite + regenerate + judge).toBeLessThanOrEqual(6);
      }),
      RUNS,
    );
  });

  it("logs hold no letter text, line text, details or key-fact values", async () => {
    // **Validates: Requirements 7.4**
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        const { logs, events, rec } = await run(s);
        const out = JSON.stringify([logs, events]);
        expect(out).not.toContain("zq");
        expect(logs.filter((l) => l.msg === "pipeline_attempt")).toHaveLength(rec.checked.length);
      }),
      RUNS,
    );
  });
});

// --- examples ---------------------------------------------------------------------

const S: Sentence[] = [
  { id: "s1", text: "zqfirst", start: 0, end: 7 },
  { id: "s2", text: "zqsecond", start: 8, end: 16 },
  { id: "s3", text: "zqthird", start: 17, end: 24 },
];
const FACT: KeyFact = { id: "f1", type: "money", value: "zq45", normalised: "4500 GBP", start: 0, end: 4, sentence_id: "s2" };
const draft = (text: string, sourceSentenceId: string): DraftLine => ({ text, sourceSentenceId, symbolQuery: "" });
const pass: TryPlan = { p1: [], rules: {}, judgeAvailable: true, p9: [], p10: [] };

function scenarioOf(partial: Partial<Scenario>): Scenario {
  return { sentences: S, keyFacts: [], drafts: [draft("a", "s1")], plans: [pass], splits: [1], ...partial };
}

async function runOf(s: Scenario) {
  const f = fakes(s);
  const result = await convert(originalOf(s), { checker: f.checker, model: f.model, logger: () => {} });
  return { result, rec: f.rec };
}

describe("convert: examples", () => {
  it("passes on the first try and attaches no symbols yet", async () => {
    const { result, rec } = await runOf(scenarioOf({ drafts: [draft("a", "s1"), draft("b", "s2")] }));
    expect(result.status).toBe("passed");
    expect(result.attempts).toBe(1);
    expect(rec.modelCalls.regenerate).toBe(0);
    expect(result.lines).toEqual([
      { id: "L1", text: "a", source_sentence_id: "s1", symbol_id: null },
      { id: "L2", text: "b", source_sentence_id: "s2", symbol_id: null },
    ]);
    expect(result.judgeAvailable).toBe(true);
    expect(result.models.map((m) => m.task)).toEqual(["rewrite", "judge"]);
  });

  it("maps a missing fact to the lines from its source sentence", async () => {
    const s = scenarioOf({
      keyFacts: [FACT],
      drafts: [draft("a", "s1"), draft("b", "s2"), draft("c", "s2")],
      plans: [{ ...pass, p1: [{ fact: 0, changed: false, pick: 0 }] }, pass],
    });
    const { result, rec } = await runOf(s);
    expect(rec.regenerateInputs[0].failing.map((f) => f.line.id)).toEqual(["L2", "L3"]);
    expect(rec.regenerateInputs[0].failing[0].failures[0].rule).toBe("P1");
    expect(rec.regenerateInputs[0].missingFacts).toEqual([]);
    expect(result.status).toBe("passed");
    expect(result.attempts).toBe(2);
  });

  it("asks for a new line when no line comes from the missing fact's sentence", async () => {
    const s = scenarioOf({
      keyFacts: [FACT],
      drafts: [draft("a", "s1"), draft("c", "s3")],
      plans: [{ ...pass, p1: [{ fact: 0, changed: false, pick: 0 }] }, pass],
    });
    const { result, rec } = await runOf(s);
    expect(rec.regenerateInputs[0].failing).toEqual([]);
    expect(rec.regenerateInputs[0].missingFacts).toEqual([FACT]);
    // The added line goes between the lines from s1 and s3.
    expect(result.lines.map((l) => [l.id, l.source_sentence_id])).toEqual([
      ["L1", "s1"],
      ["L3", "s2"],
      ["L2", "s3"],
    ]);
  });

  it("blocks with no lines when P1 still fails after 3 tries", async () => {
    const s = scenarioOf({ keyFacts: [FACT], drafts: [draft("b", "s2")], plans: [{ ...pass, p1: [{ fact: 0, changed: true, pick: 0 }] }] });
    const { result, rec } = await runOf(s);
    expect(result.status).toBe("blocked");
    expect(result.lines).toEqual([]);
    expect(result.attempts).toBe(3);
    expect(rec.modelCalls.regenerate).toBe(2);
    expect(result.checks[0].failed_fact_ids).toEqual(["f1"]);
    expect(result.notice).toBe(NOTICE);
    expect(result.original.text).toBe(originalOf(s));
  });

  it("flags a rule that still fails after 3 tries and keeps the lines", async () => {
    const s = scenarioOf({ plans: [{ ...pass, rules: { P4: [0] } }] });
    const { result } = await runOf(s);
    expect(result.status).toBe("flagged");
    expect(result.attempts).toBe(3);
    expect(result.lines).toHaveLength(1);
    expect(result.checks.find((c) => c.rule === "P4")?.passed).toBe(false);
  });

  it("flags P9 and P10 when the judge is unavailable, without regenerating for it", async () => {
    const s = scenarioOf({ drafts: [draft("a", "s1"), draft("b", "s2")], plans: [{ ...pass, judgeAvailable: false }] });
    const { result, rec } = await runOf(s);
    expect(result.status).toBe("flagged");
    expect(result.attempts).toBe(1);
    expect(rec.modelCalls.regenerate).toBe(0);
    expect(result.judgeAvailable).toBe(false);
    for (const rule of ["P9", "P10"] as Rule[]) {
      const c = result.checks.find((x) => x.rule === rule)!;
      expect(c.passed).toBe(false);
      expect(c.details.every((d) => d.endsWith(JUDGE_UNAVAILABLE))).toBe(true);
    }
  });

  it("regenerates other failures while the judge is unavailable, but sends only those lines", async () => {
    const s = scenarioOf({
      drafts: [draft("a", "s1"), draft("b", "s2")],
      plans: [{ ...pass, judgeAvailable: false, rules: { P2: [1] } }, pass],
    });
    const { result, rec } = await runOf(s);
    expect(rec.regenerateInputs[0].failing.map((f) => f.line.id)).toEqual(["L2"]);
    expect(rec.regenerateInputs[0].failing[0].failures.map((f) => f.rule)).toEqual(["P2"]);
    expect(result.status).toBe("passed");
    expect(result.judgeAvailable).toBe(true);
  });

  it("lets CheckerUnavailable through, so the route returns 503", async () => {
    const s = scenarioOf({ plans: [{ ...pass, rules: { P2: [0] } }] });
    const a = fakes(s, { failAnalyse: true });
    await expect(convert("x", { checker: a.checker, model: a.model, logger: () => {} })).rejects.toBeInstanceOf(CheckerUnavailable);
    expect(a.rec.modelCalls.rewrite).toBe(0);
    const b = fakes(s, { failCheckOn: 2 });
    await expect(convert("x", { checker: b.checker, model: b.model, logger: () => {} })).rejects.toBeInstanceOf(CheckerUnavailable);
  });

  it("streams progress events for each try", async () => {
    const events: ProgressEvent[] = [];
    const f = fakes(scenarioOf({ plans: [{ ...pass, rules: { P2: [0] } }, pass] }));
    await convert("x", { checker: f.checker, model: f.model, logger: () => {}, onProgress: (e) => events.push(e) });
    expect(events.map((e) => `${e.stage}:${e.attempt}`)).toEqual([
      "analysing:1",
      "rewriting:1",
      "checking:1",
      "regenerating:1",
      "checking:2",
    ]);
    expect(events.every((e) => e.maxAttempts === 3)).toBe(true);
  });
});

describe("decide and helpers", () => {
  const line = (id: string, src: string): Line => ({ id, text: id, source_sentence_id: src, symbol_id: null });
  const ok = (rule: Rule): CheckResult => ({ rule, passed: true, line_ids: [], failed_fact_ids: [], details: [] });

  it("fails a rule with no result, so a gap is never a pass", () => {
    const r: ConversionResult = decide("x", S, [], [line("L1", "s1")], RULES.filter((r) => r !== "P5").map(ok), 1);
    expect(r.checks.map((c) => c.rule)).toEqual(RULES);
    expect(r.checks.find((c) => c.rule === "P5")?.passed).toBe(false);
    expect(r.status).toBe("flagged");
  });

  it("finds missing facts only when no line comes from their sentence", () => {
    const p1: CheckResult = { rule: "P1", passed: false, line_ids: [], failed_fact_ids: ["f1"], details: ["f1 (money) is missing from the output"] };
    const ctx = { keyFacts: [FACT], judgeAvailable: true };
    expect(missingFacts([p1], { ...ctx, lines: [line("L1", "s1")] })).toEqual([FACT]);
    expect(missingFacts([p1], { ...ctx, lines: [line("L1", "s2")] })).toEqual([]);
    expect([...failingLineIds([p1], { ...ctx, lines: [line("L1", "s1"), line("L2", "s2")] })]).toEqual(["L2"]);
  });

  it("keeps the failing line's ID for its first replacement and gives extra lines new IDs", () => {
    const ids = new LineIds();
    ids.next();
    ids.next();
    const lines = [line("L1", "s1"), line("L2", "s2")].map((l) => ({ ...l, symbolQuery: "" }));
    const out = applyRegeneration(
      lines,
      new Set(["L1"]),
      { replacements: [{ lineId: "L1", lines: [draft("x", "s1"), draft("y", "s1")] }], added: [] },
      S,
      ids,
    );
    expect(out.map((l) => [l.id, l.text])).toEqual([
      ["L1", "x"],
      ["L3", "y"],
      ["L2", "L2"],
    ]);
  });
});
