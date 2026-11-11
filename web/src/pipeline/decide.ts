/**
 * Pure decisions for the pipeline: which lines to regenerate, which key facts
 * need a new line, and the final status (design "Pipeline orchestrator").
 */
import type { ActionSynonym, CheckResult, KeyFact, Line, Sentence } from "@/src/checker-client/schemas";
import type { ConversionResult, ModelUse, Rule, Status } from "./types";

export const MAX_ATTEMPTS = 3;

export const RULES: readonly Rule[] = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"];

/** R7.1. Shown on every result, including the blocked state. */
export const NOTICE = "This is a simplified version of your letter. The original letter is the official one.";

const JUDGE_RULES: ReadonlySet<Rule> = new Set(["P9", "P10"]);

/** The checker's P1 detail for a missing fact: "<fact id> (<type>) is missing from the output". */
const P1_MISSING = /^(\S+) \([a-z]+\) is missing from the output$/;

export interface FailureContext {
  lines: readonly Line[];
  keyFacts: readonly KeyFact[];
  /**
   * False when the judge gave no valid answer. P9 and P10 then fail on every
   * line with "judge unavailable", which says nothing about the lines, so those
   * failures don't send lines to regenerate.
   */
  judgeAvailable: boolean;
}

/** Exactly one result per rule, P1 to P10 in order. A rule with no result fails. */
export function completeChecks(checks: readonly CheckResult[]): CheckResult[] {
  const byRule = new Map<Rule, CheckResult>();
  for (const c of checks) if (!byRule.has(c.rule)) byRule.set(c.rule, c);
  return RULES.map(
    (rule) =>
      byRule.get(rule) ?? { rule, passed: false, line_ids: [], failed_fact_ids: [], details: ["no result for this rule"] },
  );
}

/**
 * Key facts P1 reports as missing whose source sentence has no line. The
 * regenerate prompt is asked to add a line for each.
 */
export function missingFacts(checks: readonly CheckResult[], ctx: FailureContext): KeyFact[] {
  const p1 = checks.find((c) => c.rule === "P1");
  if (!p1 || p1.passed) return [];
  const covered = new Set(ctx.lines.map((l) => l.source_sentence_id));
  const failed = new Set(p1.failed_fact_ids);
  return ctx.keyFacts.filter((f) => failed.has(f.id) && !covered.has(f.sentence_id));
}

/**
 * IDs of the lines to regenerate:
 * - every line a failed rule names, except P9 and P10 when the judge was unavailable;
 * - for a key fact P1 reports as missing, the lines from that fact's source sentence.
 * Only IDs of current lines are returned.
 */
export function failingLineIds(checks: readonly CheckResult[], ctx: FailureContext): Set<string> {
  const current = new Set(ctx.lines.map((l) => l.id));
  const out = new Set<string>();
  for (const c of checks) {
    if (c.passed) continue;
    if (!ctx.judgeAvailable && JUDGE_RULES.has(c.rule)) continue;
    for (const id of c.line_ids) if (current.has(id)) out.add(id);
    if (c.rule === "P1") {
      const missing = new Set(
        c.details.map((d) => d.match(P1_MISSING)?.[1]).filter((id): id is string => id !== undefined),
      );
      const sentences = new Set(ctx.keyFacts.filter((f) => missing.has(f.id)).map((f) => f.sentence_id));
      for (const l of ctx.lines) if (sentences.has(l.source_sentence_id)) out.add(l.id);
    }
  }
  return out;
}

/**
 * The checks with the regeneration targets made explicit, for
 * `collectFailures`: P1 also names the lines mapped from missing facts, and
 * P9 and P10 are dropped when the judge was unavailable.
 */
export function regenerationChecks(
  checks: readonly CheckResult[],
  failing: ReadonlySet<string>,
  ctx: FailureContext,
): CheckResult[] {
  const out: CheckResult[] = [];
  for (const c of checks) {
    if (!ctx.judgeAvailable && JUDGE_RULES.has(c.rule)) continue;
    if (c.rule === "P1" && !c.passed) {
      // Add the failing lines from a failed fact's source sentence, so collectFailures gives them P1's details.
      const factSentences = new Set(
        ctx.keyFacts.filter((f) => c.failed_fact_ids.includes(f.id)).map((f) => f.sentence_id),
      );
      const named = new Set(c.line_ids);
      const added = ctx.lines
        .filter((l) => failing.has(l.id) && !named.has(l.id) && factSentences.has(l.source_sentence_id))
        .map((l) => l.id);
      out.push({ ...c, line_ids: [...c.line_ids, ...added] });
      continue;
    }
    out.push(c);
  }
  return out;
}

export function statusOf(checks: readonly CheckResult[]): Status {
  if (checks.some((c) => c.rule === "P1" && !c.passed)) return "blocked";
  if (checks.some((c) => !c.passed)) return "flagged";
  return "passed";
}

export interface DecideExtras {
  judgeAvailable: boolean;
  models: ModelUse[];
  actionSynonyms?: ActionSynonym[];
}

/**
 * The final result. "blocked" if P1 failed, "flagged" if any other rule
 * failed, otherwise "passed". A blocked result holds no lines (R2.5).
 */
export function decide(
  original: string,
  sentences: Sentence[],
  keyFacts: KeyFact[],
  lines: Line[],
  checks: readonly CheckResult[],
  attempt: number,
  extras: DecideExtras = { judgeAvailable: true, models: [] },
): ConversionResult {
  const all = completeChecks(checks);
  const status = statusOf(all);
  return {
    status,
    original: { text: original, sentences },
    keyFacts,
    lines: status === "blocked" ? [] : lines.map((l) => ({ ...l })),
    checks: all,
    attempts: attempt,
    notice: NOTICE,
    judgeAvailable: extras.judgeAvailable,
    models: extras.models,
    actionSynonyms: extras.actionSynonyms ?? [],
    // Filled in by `convert` from the checker once the lines are final.
    lineFacts: [],
  };
}
