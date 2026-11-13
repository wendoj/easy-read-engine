import { z } from "zod";
import type { CheckResult, KeyFact, Line, LineFactSpan, Sentence } from "@/src/checker-client/schemas";
import { MAX_ID_CHARS } from "./errors";
import { mergeJudgeChecks, withJudgeChecks } from "./merge";

/** The checker calls the check, export and sample routes make. */
export interface RouteChecker {
  /** Throws `CheckerUnavailable` when the service is down or starting. */
  health(): Promise<{ status: "ok" | "starting" }>;
  analyse(original: string): Promise<{ sentences: Sentence[]; key_facts: KeyFact[] }>;
  check(request: { original: string; key_facts: KeyFact[]; lines: Line[] }): Promise<CheckResult[]>;
  lineFacts(request: { key_facts: KeyFact[]; lines: Line[] }): Promise<LineFactSpan[]>;
}

export const idSchema = z.string().min(1).max(MAX_ID_CHARS).regex(/^\S+$/u);

/** Fresh copies with exactly the 4 line fields, so no extra client field reaches the checker. */
export function copyLines(lines: readonly Line[]): Line[] {
  return lines.map((l) => ({ id: l.id, text: l.text, source_sentence_id: l.source_sentence_id, symbol_id: l.symbol_id }));
}

/**
 * P1 to P8 run again against the Original, with P9 and P10 carried over from
 * `previous` for every line. Key facts come from the Original, never from the
 * client. Null when a line names a sentence the Original doesn't have.
 */
export async function recheckLines(
  checker: Pick<RouteChecker, "analyse" | "check">,
  original: string,
  lines: Line[],
  previous: readonly CheckResult[],
): Promise<{ sentences: Sentence[]; keyFacts: KeyFact[]; checks: CheckResult[] } | null> {
  const { sentences, key_facts: keyFacts } = await checker.analyse(original);
  const sentenceIds = new Set(sentences.map((s) => s.id));
  if (lines.some((l) => !sentenceIds.has(l.source_sentence_id))) return null;
  const ruleChecks = await checker.check({ original, key_facts: keyFacts, lines });
  const judgeChecks = mergeJudgeChecks(previous, [], new Set(lines.map((l) => l.id)));
  return { sentences, keyFacts, checks: withJudgeChecks(ruleChecks, judgeChecks) };
}
