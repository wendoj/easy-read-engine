/**
 * Pipeline settings for pictograms (design "Symbols").
 */

/**
 * A line gets the checker's top match only when its score is above this;
 * otherwise it has no picture (R4.2).
 *
 * `find_symbol` scores (checker/src/checks/symbols.py) are
 *   coverage (0 to 1) + 0.25 * specificity (0 to 1) + 0.5 if the query is exactly a keyword.
 * Coverage is 1 only when every word of the query is one of the pictogram's
 * keywords; tag-only matches add at most 0.25. Above 1.2 therefore means every
 * query word is a keyword of the pictogram and either the query is exactly
 * one of its keywords (1.5 to 1.75) or the pictogram has no other keyword
 * words (1.25).
 *
 * Chosen from scores for typical `symbolQuery` values (11 November 2026):
 * "pay", "doctor", "letter", "phone", "form", "money", "car park", "send letter"
 * score 1.25 to 1.75 with the right picture on top. Weaker matches that 1.2
 * leaves out: "council" (top match "sports council", 1.125), "online"
 * ("online video button", 1.08), "benefit" ("grants", 1.04), and half-matched
 * pairs such as "council tax" ("sports council", 0.625) or "pay money" (0.875).
 * No picture is better than a wrong one, so the bar is high.
 */
export const SYMBOL_MIN_SCORE = 1.2;

/** Most `/symbols` requests in flight at once for one conversion. */
export const SYMBOL_LOOKUP_CONCURRENCY = 4;
