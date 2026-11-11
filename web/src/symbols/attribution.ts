/**
 * ARASAAC attribution (R4.4), worded exactly as in
 * checker/data/LICENSE-pictograms.md. Shown in the result screen footer, and
 * for the PDF footer (task 28).
 */
export const ARASAAC_URL = "https://arasaac.org";
export const ARASAAC_LICENCE_URL = "https://creativecommons.org/licenses/by-nc-sa/4.0/";

export const ARASAAC_ATTRIBUTION =
  "Pictograms: Sergio Palao. Origin: ARASAAC (https://arasaac.org). Licence: CC BY-NC-SA. Owner: Government of Aragón (Spain).";

/** The attribution as text and link parts, joined in order they give `ARASAAC_ATTRIBUTION`. */
export const ARASAAC_ATTRIBUTION_PARTS: readonly ({ text: string; href?: string })[] = [
  { text: "Pictograms: Sergio Palao. Origin: ARASAAC (" },
  { text: "https://arasaac.org", href: ARASAAC_URL },
  { text: "). Licence: " },
  { text: "CC BY-NC-SA", href: ARASAAC_LICENCE_URL },
  { text: ". Owner: Government of Aragón (Spain)." },
];
