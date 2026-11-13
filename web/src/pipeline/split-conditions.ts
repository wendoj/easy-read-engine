/**
 * Split "If X, Y." lines into "Maybe X." and "Then Y." in code, because the
 * model still wrote them after 3 tries and P3 fails them. A trailing "Y if X."
 * becomes "Maybe X." and "Then y.". The words are kept; only "If" becomes
 * "Maybe" and "Then" is added.
 *
 * A line is left alone when the comma may be inside the condition (the result
 * starts with "and", "or", "but" or "nor") or when it has more than 1
 * sentence. A trailing "if" line is also left alone on "even if",
 * "Check if ...", a bare "if you can", a web address, or a first word that a
 * lower-case "Then" can't safely follow.
 */
import type { DraftLine } from "@/src/llm";

// A comma with no space after it ("£1,000") is part of the condition.
const CONDITION = /^If\s+((?:[^,]|,(?!\s))+?),\s+(?:then\s+)?(.+)$/;
const JOINING = /^(and|or|but|nor)\b/i;
// "... main part if you ... ." The condition starts with a subject word.
const TRAILING_IF = /^(.+?)\s+if\s+((?:you|your|we|they|it|there|the|this|someone|anyone|no one)\b[^,.?!;:]*)\.$/i;
// Main parts that end where "if" means "whether", or that make the "if" part of the sentence.
const IF_AS_OBJECT = /\b(?:check|see|ask|know|tell us|let us know|wonder|decide|find out|even|only|as|what|not sure|unsure)$/i;
// A condition that ends here has no point of its own ("if you can").
const BARE_HELPER = /\b(?:can|could|will|would|are|is|am|do|does|have|has|need|want|must|should|may|might)$/i;
// First words a lower-case "Then ..." can follow without breaking a name.
const SAFE_FIRST = new Set([
  "you", "your", "we", "our", "they", "it", "the", "this", "that", "there", "please", "a", "an",
  "pay", "call", "tell", "send", "contact", "ask", "write", "phone", "give", "show", "bring", "fill", "return",
]);
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** The 2 lines for one "If X, Y." line, or null to keep the line as it is. */
export function splitCondition(text: string): [string, string] | null {
  const trimmed = text.trim();
  const match = CONDITION.exec(trimmed);
  if (!match) return splitTrailingCondition(trimmed) ?? splitJoinedClauses(trimmed);
  const [, condition, result] = match;
  if (words(condition) < 2 || words(result) < 2) return null;
  if (JOINING.test(result)) return null;
  // One sentence only, ending at the end of the line.
  if (!/[.?!]$/.test(result) || /[.?!]\s/.test(result)) return null;
  return [`Maybe ${condition}.`, `Then ${result}`];
}

/**
 * "X, and we want to help." as "X." and "We want to help.": two full clauses
 * with their own subjects, joined by ", and". Nothing is added or dropped.
 */
function splitJoinedClauses(trimmed: string): [string, string] | null {
  if (/[.?!]\s/.test(trimmed)) return null;
  const match = /^([^,]+(?:,(?!\s+and\s)[^,]*)*),\s+and\s+((?:you|we|they|it)\s+\S.*[.?!])$/i.exec(trimmed);
  if (!match) return null;
  const [, first, second] = match;
  if (words(first) < 3 || words(second) < 3) return null;
  return [`${first}.`, `${second[0].toUpperCase()}${second.slice(1)}`];
}

/** "Y if X." as "Maybe X." and "Then y.", or null to keep the line as it is. */
function splitTrailingCondition(trimmed: string): [string, string] | null {
  if (/[.?!]\s/.test(trimmed) || /www\.|https?:|\.(?:uk|com|org)\b/i.test(trimmed)) return null;
  const match = TRAILING_IF.exec(trimmed);
  if (!match) return null;
  const [, main, condition] = match;
  if (words(main) < 2 || words(condition) < 2) return null;
  if (IF_AS_OBJECT.test(main) || BARE_HELPER.test(condition) || /,\s*$/.test(main)) return null;
  const first = main.split(/\s+/)[0] ?? "";
  if (!SAFE_FIRST.has(first.toLowerCase())) return null;
  return [`Maybe ${condition}.`, `Then ${first.toLowerCase()}${main.slice(first.length)}.`];
}

/**
 * Split every "If X, Y." line. The picture query goes with the "Then" line,
 * which holds the action. Both lines keep the source sentence.
 */
export function splitConditions(lines: readonly DraftLine[]): DraftLine[] {
  return lines.flatMap((line) => {
    const split = splitCondition(line.text);
    if (!split) return [line];
    return [
      { ...line, text: split[0], symbolQuery: "" },
      { ...line, text: split[1] },
    ];
  });
}
