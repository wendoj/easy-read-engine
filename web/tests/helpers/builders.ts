import type { CheckResult, KeyFact, Sentence } from "@/src/checker-client/schemas";
import { NOTICE } from "@/src/pipeline/decide";
import type { ConversionResult, Rule } from "@/src/pipeline/types";

export const passed = (rule: Rule): CheckResult => ({ rule, passed: true, line_ids: [], failed_fact_ids: [], details: [] });

/** A passed result with no lines. Tests override the fields they care about. */
export function conversionResult(overrides: Partial<ConversionResult> = {}): ConversionResult {
  return {
    status: "passed",
    original: { text: "", sentences: [] },
    keyFacts: [],
    lines: [],
    checks: [],
    attempts: 1,
    notice: NOTICE,
    judgeAvailable: true,
    models: [],
    actionSynonyms: [],
    lineFacts: [],
    ...overrides,
  };
}

/** Finds each sentence in `original` in order, plus one money fact for "£45" in sentence s1. */
export function analysisOf(texts: readonly string[], original: string): { sentences: Sentence[]; key_facts: KeyFact[] } {
  const sentences: Sentence[] = [];
  let cursor = 0;
  texts.forEach((text, i) => {
    const start = original.indexOf(text, cursor);
    sentences.push({ id: `s${i + 1}`, text, start, end: start + text.length });
    cursor = start + text.length;
  });
  const at = original.indexOf("£45");
  return {
    sentences,
    key_facts: [{ id: "f1", type: "money", value: "£45", normalised: "GBP45.00", start: at, end: at + 3, sentence_id: "s1" }],
  };
}

export function jsonPost(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
