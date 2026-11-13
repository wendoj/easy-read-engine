/**
 * Split "If X, Y." lines into "Maybe X." and "Then Y." without a model call.
 *
 * P3 allows 1 main verb clause per sentence, and an "if" clause with its own
 * subject counts as a second one. The prompts ask for this split, but the
 * recorded samples (November 2026) still had "If you can't pay, we can help."
 * lines after 3 tries. This is the same pattern the prompts teach
 * ("You may not be able to pay." / "Then you must tell the council."), done
 * in code on the model's lines before they are checked.
 *
 * A line that ends in an "if" clause ("You can claim help if your income is
 * low.") is split the other way round: "Maybe your income is low." then "Then
 * you can claim help." It is left alone when the "if" is "even if", when the
 * condition ends on a bare helper verb ("... if you can."), when the main part
 * ends on a word that takes "if" as its object ("Check if ..."), when the
 * line has a web address, or when its first word is not one a lower-case
 * "Then ..." can safely follow (a name, for example).
 *
 * Only a line that starts with "If " and has ", " after a condition of at
 * least 2 words is split. The result must be at least 2 words and end the
 * sentence, and it must not start with "and", "or", "but" or "nor" (then the
 * comma was inside the condition). Lines with more than 1 sentence are left
 * alone. The words are kept; only "If" becomes "Maybe" and "Then" is added.
 * The checks run on the split lines as on any other.
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
