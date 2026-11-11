/**
 * The letter length limit (R1.7). Shared by `/api/convert` and the input
 * screen (task 21), so both count the same way. No imports, so a client
 * component can import this file directly: `@/src/convert/word-count`.
 */

/** One request must fit under 8,000 tokens (design "Token budget"). */
export const MAX_WORDS = 1500;

/**
 * Also limits characters, so a few very long "words" can't get past the word
 * limit. 15,000 is 10 characters per word, well above English letters.
 */
export const MAX_CHARACTERS = 15_000;

/** Words are runs of characters between whitespace, the way word processors count them. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

export type LengthProblem = "empty" | "too_many_words" | "too_many_characters";

export function letterLengthProblem(text: string): LengthProblem | null {
  if (text.trim() === "") return "empty";
  if (text.length > MAX_CHARACTERS) return "too_many_characters";
  if (countWords(text) > MAX_WORDS) return "too_many_words";
  return null;
}

/** The R1.7 message. Holds only counts, never letter content. */
export function tooLongMessage(words: number): string {
  return `This letter has ${words.toLocaleString("en-GB")} words. Letters can have up to ${MAX_WORDS.toLocaleString("en-GB")} words. Remove some text and try again.`;
}

export const TOO_MANY_CHARACTERS_MESSAGE = `This letter is too long. Letters can have up to ${MAX_WORDS.toLocaleString("en-GB")} words and ${MAX_CHARACTERS.toLocaleString("en-GB")} characters. Remove some text and try again.`;
