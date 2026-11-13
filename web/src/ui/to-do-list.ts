/**
 * "What you need to do": checked Easy Read lines that hold a required action.
 * No new text is written. A deadline is the one full date in the line; a date
 * with no year, or 2 different dates, gives none, so a date is never guessed.
 */
import type { ConversionResult } from "@/src/pipeline/types";
import type { LineRow } from "./result-layout";

export interface ToDoItem {
  row: LineRow;
  /** `YYYY-MM-DD`. */
  deadline: string | null;
}

const FULL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The same string back if it is a real calendar date, else null. */
export function validIsoDate(value: string): string | null {
  const m = FULL_DATE.exec(value);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  const real = d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
  return real ? value : null;
}

/*
 * The checker marks every instruction-shaped phrase as an action, so P1 loses
 * none. Not all are things the reader has to do. A line is left out of the list
 * (it stays in the Easy Read version) when it is:
 * - a condition: the source starts with "If", "Unless" or "When", has an "if"
 *   that isn't a softener ("if you can", "if possible"), or the line starts with
 *   "Maybe", "Then" or "So" (the If-split)
 * - an option: "you can", "you may", "why not", "if you want"
 * - a question, or "ignore" / "disregard"
 * - another way to do the same thing: starts with "Or", or "for more information"
 * - a menu (a bullet, or a line ending in ":"), unless it says "must", "need to",
 *   "have to" or "required". A missing full stop says nothing: PDF tables often have none
 *
 * Letters repeat themselves, so a line is also left out when its text, or every
 * action in it, is already listed. When one item's words hold another's, only
 * the fuller one is kept, in the earlier place.
 */
const CONDITION_START = /^[\s•*–-]*(if|unless|when)\b/iu;
// "if you can" and "if possible" are softeners; "if you can't pay" is a condition.
const CONDITION = /\bif\b(?!\s+(you\s+can\b(?!['’]t)|possible\b))/iu;
const RESULT_LINE = /^\s*(maybe|then|so)\b/iu;
const OPTION = /\bwhy not\b|\byou\s+(can|could|may)\b|\bif\s+you\s+(want|wish|would like|prefer)\b/iu;
const NOT_A_TASK = /\b(ignore|disregard)\b|^\s*or\b|\bfor more information\b/iu;
const BULLET = /^[\s]*[•*–-]/u;
const OBLIGATION = /\b(must|need to|needs to|have to|has to|required)\b/iu;
/** "if you can" doesn't make an option: "Please pay now if you can." is a request. */
const SOFT_IF = /\bif\s+you\s+can\b(?!['’]t)/giu;

export function isTask(lineText: string, sourceText: string): boolean {
  const source = sourceText.trim();
  if (RESULT_LINE.test(lineText) || NOT_A_TASK.test(lineText) || CONDITION.test(lineText)) return false;
  if (CONDITION_START.test(source) || CONDITION.test(source) || source.endsWith("?")) return false;
  const menu = BULLET.test(source) || source.endsWith(":");
  if (menu && !OBLIGATION.test(lineText) && !OBLIGATION.test(source)) return false;
  const withoutSoftIf = (text: string) => text.replace(SOFT_IF, "");
  return !OPTION.test(withoutSoftIf(lineText)) && !OPTION.test(withoutSoftIf(source));
}

/** For spotting repeats. */
function sameKey(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function buildToDoItems(result: ConversionResult, rows: readonly LineRow[]): ToDoItem[] {
  if (result.status === "blocked") return [];
  const facts = new Map(result.keyFacts.map((f) => [f.id, f]));
  const sources = new Map(result.original.sentences.map((s) => [s.id, s.text]));
  const seenActions = new Set<string>();
  const items: ToDoItem[] = [];
  const keys: string[] = [];
  for (const row of rows) {
    const inLine = result.lineFacts.filter((s) => s.line_id === row.id).flatMap((s) => facts.get(s.fact_id) ?? []);
    const actions = inLine.filter((f) => f.type === "action").map((f) => sameKey(f.value));
    if (actions.length === 0) continue;
    if (!isTask(row.text, row.sourceSentenceId === null ? "" : (sources.get(row.sourceSentenceId) ?? ""))) continue;
    const text = sameKey(row.text);
    if (actions.every((a) => seenActions.has(a))) continue;
    if (keys.some((k) => ` ${k} `.includes(` ${text} `))) continue;
    for (const a of actions) seenActions.add(a);
    const shorter = keys.findIndex((k) => ` ${text} `.includes(` ${k} `));
    const dates = new Set(inLine.flatMap((f) => (f.type === "date" ? (validIsoDate(f.normalised) ?? []) : [])));
    const item = { row, deadline: dates.size === 1 ? [...dates][0] : null };
    if (shorter >= 0) {
      items[shorter] = item;
      keys[shorter] = text;
    } else {
      items.push(item);
      keys.push(text);
    }
  }
  return items;
}

export function toDoCountLabel(count: number): string {
  return `${count} ${count === 1 ? "thing" : "things"} to do`;
}
