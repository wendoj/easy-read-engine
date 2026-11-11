/**
 * Word-limit state for the confirm step (R1.7). Uses the same counting and
 * messages as `/api/convert`, so the screen and the server always agree.
 */
import {
  MAX_WORDS,
  TOO_MANY_CHARACTERS_MESSAGE,
  countWords,
  letterLengthProblem,
  type LengthProblem,
  tooLongMessage,
} from "@/src/convert/word-count";

export interface WordLimitState {
  words: number;
  problem: LengthProblem | null;
  /** True when the text can be sent to `/api/convert`. */
  canConvert: boolean;
  /** True when the text is over the word or character limit. */
  overLimit: boolean;
  /** For the Badge, for example "320 of 1,500 words". */
  label: string;
  /** The R1.7 message when over the limit, otherwise null. */
  message: string | null;
}

export function wordLimitState(text: string): WordLimitState {
  const words = countWords(text);
  const problem = letterLengthProblem(text);
  const overLimit = problem === "too_many_words" || problem === "too_many_characters";
  let message: string | null = null;
  if (problem === "too_many_words") message = tooLongMessage(words);
  else if (problem === "too_many_characters") message = TOO_MANY_CHARACTERS_MESSAGE;
  return {
    words,
    problem,
    canConvert: problem === null,
    overLimit,
    label: `${words.toLocaleString("en-GB")} of ${MAX_WORDS.toLocaleString("en-GB")} words`,
    message,
  };
}
