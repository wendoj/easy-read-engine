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
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** The 2 lines for one "If X, Y." line, or null to keep the line as it is. */
export function splitCondition(text: string): [string, string] | null {
  const trimmed = text.trim();
  const match = CONDITION.exec(trimmed);
  if (!match) return null;
  const [, condition, result] = match;
  if (words(condition) < 2 || words(result) < 2) return null;
  if (JOINING.test(result)) return null;
  // One sentence only, ending at the end of the line.
  if (!/[.?!]$/.test(result) || /[.?!]\s/.test(result)) return null;
  return [`Maybe ${condition}.`, `Then ${result}`];
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
