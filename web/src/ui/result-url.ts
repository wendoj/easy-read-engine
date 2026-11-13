/**
 * A result lives only in React state, so a reload loses it. Letter text is
 * never stored to get it back. Sample letters are public, so their ID goes in
 * the URL and a reload loads them again; the user's own letter is gone.
 */

/** Sample IDs are file names in `web/data/samples`. */
const SAMPLE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MAX_SAMPLE_ID_LENGTH = 100;

/** Null when the param is missing, repeated or malformed. The server checks the ID against the catalog. */
export function parseSampleId(value: string | string[] | undefined | null): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > MAX_SAMPLE_ID_LENGTH) return null;
  return SAMPLE_ID.test(value) ? value : null;
}

export function resultHref(sampleId: string | null): string {
  const id = parseSampleId(sampleId);
  return id === null ? "/result" : `/result?sample=${encodeURIComponent(id)}`;
}

export const GONE_HEADING = "Your Easy Read version is gone";
export const GONE_MESSAGE = "We do not keep letters, so the page lost it when it reloaded. Start again to make a new one.";
export const SAMPLE_LOADING_MESSAGE = "Loading the sample letter";
