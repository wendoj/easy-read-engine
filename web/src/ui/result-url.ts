/**
 * The result screen's URL, and what it shows after a reload (R7.4).
 *
 * A result lives only in React state, so a reload loses it. Letter text is
 * never stored to get it back: no localStorage, sessionStorage, IndexedDB,
 * cookies or server cache (safety.md "Never store or log letter text").
 *
 * - A sample letter is public text, so its ID goes in the URL
 *   (`/result?sample=<id>`). After a reload the result screen loads the
 *   sample again from `/api/sample`.
 * - The user's own letter has no ID in the URL. After a reload the screen
 *   says the Easy Read version is gone and offers "Start again".
 */

/** Sample IDs are file names in `web/data/samples`: lowercase words joined by hyphens. */
const SAMPLE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MAX_SAMPLE_ID_LENGTH = 100;

/**
 * The sample ID from the `sample` search param, or null when it is missing,
 * repeated or not a valid ID. The server checks the ID against the catalog.
 */
export function parseSampleId(value: string | string[] | undefined | null): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > MAX_SAMPLE_ID_LENGTH) return null;
  return SAMPLE_ID.test(value) ? value : null;
}

/** `/result`, or `/result?sample=<id>` for a sample letter. */
export function resultHref(sampleId: string | null): string {
  const id = parseSampleId(sampleId);
  return id === null ? "/result" : `/result?sample=${encodeURIComponent(id)}`;
}

export const GONE_HEADING = "Your Easy Read version is gone";
export const GONE_MESSAGE = "We do not keep letters, so the page lost it when it reloaded. Start again to make a new one.";
export const SAMPLE_LOADING_MESSAGE = "Loading the sample letter";
