/**
 * A line gets the checker's top match only when its score is above this.
 * No picture is better than a wrong one, so the bar is high.
 *
 * `find_symbol` scores are coverage (0 to 1) + 0.25 * specificity (0 to 1)
 * + 0.5 if the query is exactly a keyword. Above 1.2 means every query word
 * is a keyword of the pictogram, and either the query is exactly one of its
 * keywords or the pictogram has no other keyword words. "pay", "doctor" and
 * "car park" score 1.25 to 1.75 with the right picture. "council" (top match
 * "sports council", 1.125) and "council tax" (0.625) are left out.
 */
export const SYMBOL_MIN_SCORE = 1.2;

/** Most `/symbols` requests in flight at once for one conversion. */
export const SYMBOL_LOOKUP_CONCURRENCY = 4;
