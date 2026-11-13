/** Uses the same counting and messages as `/api/convert`, so the screen and the server agree. */
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
  canConvert: boolean;
  overLimit: boolean;
  /** For example "320 of 1,500 words". */
  label: string;
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
