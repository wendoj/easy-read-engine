/**
 * "What you need to do": a checklist built from the lines the checker already
 * matched to the Original's required actions.
 *
 * Nothing is written here. An item is an Easy Read line that holds a required
 * action (a key fact of type "action", found by `POST /line-facts`), so its
 * wording was checked like every other line. Failed rules are in the Check
 * report, not on the item. A deadline is the one full date (day, month and year) in that line. A
 * date with no year, or a line with 2 different dates, gets no deadline: the
 * date is never guessed (safety.md).
 *
 * Never logs. Holds letter text only in what it returns (R7.4).
 */
import type { ConversionResult } from "@/src/pipeline/types";
import type { LineRow } from "./result-layout";

export interface ToDoItem {
  /** The line this item is. */
  row: LineRow;
  /** `YYYY-MM-DD` of the deadline, or null. */
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
 * The checker marks every instruction-shaped phrase in the letter as an
 * action, so P1 can make sure none is lost. Not all of them are things the
 * reader has to do. These leave a line out of the list (the line itself is
 * still in the Easy Read version):
 *
 * - a condition: the source sentence starts with "If", "Unless" or "When",
 *   the line or its sentence has an "if" that isn't a softener ("if you
 *   can", "if possible"), or the line starts with "Maybe", "Then" or "So"
 *   (the If-split and its result). An action that applies only sometimes
 *   ("Call us if you can't pay") is not on everyone's list
 * - an option or a suggestion: "you can", "you may", "why not", "if you want"
 * - a question: "Need help with council tax?"
 * - "ignore" or "disregard": "Please ignore this." is never a task
 * - another way to do the same thing: a line that starts with "Or", or
 *   "for more information"
 * - a menu: a bullet point, or a line that opens a list ("Help yourself
 *   online:", "• Check your account"), unless it says the reader must do it
 *   ("must", "need to", "have to", "required"). A missing full stop says
 *   nothing: text from a PDF table often has none ("Pay full amount")
 *
 * Letters repeat themselves (the same box on the front and the back), so a
 * line is also left out when its text, or every action in it, is already in
 * the list. When one item's words hold another's ("Call 0161 234 5002." and
 * "Call 0161 234 5002, 9am to 6pm."), only the fuller one is kept, in the
 * earlier place.
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

/** Whether a line with an action is something the reader has to do (see above). */
export function isTask(lineText: string, sourceText: string): boolean {
  const source = sourceText.trim();
  if (RESULT_LINE.test(lineText) || NOT_A_TASK.test(lineText) || CONDITION.test(lineText)) return false;
  if (CONDITION_START.test(source) || CONDITION.test(source) || source.endsWith("?")) return false;
  const menu = BULLET.test(source) || source.endsWith(":");
  if (menu && !OBLIGATION.test(lineText) && !OBLIGATION.test(source)) return false;
  const withoutSoftIf = (text: string) => text.replace(SOFT_IF, "");
  return !OPTION.test(withoutSoftIf(lineText)) && !OPTION.test(withoutSoftIf(source));
}

/** Lower case, with punctuation and spacing removed, for spotting repeats. */
function sameKey(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Items in line order. Empty when there are no lines, or no line holds an action the reader has to do. */
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

/** The closed to-do box's count: "1 thing to do", "4 things to do". */
export function toDoCountLabel(count: number): string {
  return `${count} ${count === 1 ? "thing" : "things"} to do`;
}
