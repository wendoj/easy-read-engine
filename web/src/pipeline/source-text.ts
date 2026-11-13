/**
 * The source text the judge sees for each sentence.
 *
 * The sentence splitter makes a postcode line a sentence of its own, so a
 * line that gives the whole address looked like it added a postcode and
 * failed P9. The postcode is joined to the sentence above it for the judge
 * only. Sentences, their IDs and key facts are unchanged.
 */
import type { Sentence } from "@/src/checker-client/schemas";

/** A line that is only a UK postcode, such as "AB1 2CD". */
const POSTCODE_ONLY = /^[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[ABD-HJLNP-UW-Zabd-hjlnp-uw-z]{2}$/;

export function judgeSourceText(sentences: readonly Sentence[]): Map<string, string> {
  const out = new Map<string, string>();
  sentences.forEach((s, i) => {
    const next = sentences[i + 1];
    const joined = next !== undefined && POSTCODE_ONLY.test(next.text.trim()) && !/[.?!:]\s*$/.test(s.text);
    out.set(s.id, joined ? `${s.text}\n${next.text.trim()}` : s.text);
  });
  return out;
}
