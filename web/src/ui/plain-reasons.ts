/**
 * Check details are written for the regenerate prompt ("L36 has 1 words that
 * are not common and not explained: arrears"). The check report and the line
 * flags show them in plain words, with the line named by its place on screen.
 * An unknown detail is shown as it is, minus its line ID, so nothing is hidden.
 */
import type { Rule } from "@/src/pipeline/types";

export interface PlainReason {
  /** The line the detail starts with, when it is a line on screen. */
  lineId: string | null;
  /** A full sentence, without the line number. */
  text: string;
}

function sentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed === "") return trimmed;
  const first = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/u.test(first) ? first : `${first}.`;
}

const PATTERNS: { rule: Rule | null; match: RegExp; plain: (m: RegExpMatchArray) => string }[] = [
  {
    rule: "P2",
    match: /^has a sentence of (\d+) words \(limit (\d+)\)$/u,
    plain: (m) => `A sentence has ${m[1]} words. The most is ${m[2]}.`,
  },
  {
    rule: "P3",
    match: /^has a sentence with (\d+) main clauses \(limit (\d+)\)$/u,
    plain: (m) => `A sentence has ${m[1]} ideas. The most is ${m[2]}.`,
  },
  { rule: "P4", match: /^uses the passive voice$/u, plain: () => "It does not say who does the action." },
  {
    rule: "P5",
    match: /^has (\d+) words that are not common and not explained(?:: (.+))?$/u,
    plain: (m) => {
      const n = Number(m[1]);
      const what = n === 1 ? "A hard word is not explained" : `${n} hard words are not explained`;
      return m[2] ? `${what}: ${m[2]}.` : `${what}.`;
    },
  },
  {
    rule: "P6",
    match: /^has (\d+) numbers written in words$/u,
    plain: (m) => (m[1] === "1" ? "A number is written in words." : `${m[1]} numbers are written in words.`),
  },
  {
    rule: "P7",
    match: /^has (\d+) abbreviations that are not explained(?:: (.+))?$/u,
    plain: (m) => {
      const n = Number(m[1]);
      const what = n === 1 ? "A short form is not explained" : `${n} short forms are not explained`;
      return m[2] ? `${what}: ${m[2]}.` : `${what}.`;
    },
  },
  { rule: "P9", match: /^meaning(?:: (.+))?$/u, plain: (m) => `The meaning may have changed${m[1] ? `: ${m[1]}` : ""}` },
  { rule: "P10", match: /^tone(?:: (.+))?$/u, plain: (m) => `The tone may not be right${m[1] ? `: ${m[1]}` : ""}` },
  { rule: "P10", match: /^advice(?:: (.+))?$/u, plain: (m) => `It may give advice${m[1] ? `: ${m[1]}` : ""}` },
  {
    rule: null,
    match: /^has no verdict from the judge$/u,
    plain: () => "The meaning and tone check gave no answer for this line.",
  },
];

/** `lineIds` are the lines on screen. */
export function plainReason(rule: Rule, detail: string, lineIds: ReadonlySet<string>): PlainReason {
  const space = detail.indexOf(" ");
  const head = space > 0 ? detail.slice(0, space) : "";
  const lineId = lineIds.has(head) ? head : null;
  const rest = lineId === null ? detail : detail.slice(space + 1);
  for (const p of PATTERNS) {
    if (p.rule !== null && p.rule !== rule) continue;
    const m = rest.match(p.match);
    if (m) return { lineId, text: sentence(p.plain(m)) };
  }
  return { lineId, text: sentence(rest) };
}

/** Plain reasons for each line on screen, in rule order. Lines with none are left out. */
export function reasonsByLine(
  checks: readonly { rule: Rule; passed: boolean; details: readonly string[] }[],
  lineIds: ReadonlySet<string>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const c of checks) {
    if (c.passed) continue;
    for (const d of c.details) {
      const r = plainReason(c.rule, d, lineIds);
      if (r.lineId === null) continue;
      out.set(r.lineId, [...(out.get(r.lineId) ?? []), r.text]);
    }
  }
  return out;
}
