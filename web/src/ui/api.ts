/**
 * Browser calls to `/api/extract` and `/api/convert`. They return plain
 * outcomes, never throw for HTTP errors, and never log or store letter text
 * (R7.4).
 */
import type { ConversionResult, ProgressEvent } from "@/src/pipeline/types";
import {
  GENERIC_MESSAGE,
  NETWORK_MESSAGE,
  STREAM_BROKEN_MESSAGE,
  errorMessage,
  readErrorBody,
} from "./api-errors";
import { parseConvertEvent } from "./convert-events";
import { readNdjson } from "./ndjson";

type Fetch = typeof fetch;

export type ApiFailure = { ok: false; error: string | null; message: string; aborted?: boolean };

export type ExtractOutcome = { ok: true; text: string; source: "pdf" | "image" } | ApiFailure;

export type ConvertOutcome = { ok: true; result: ConversionResult } | ApiFailure;

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function failure(err: unknown, message: string): ApiFailure {
  return isAbort(err) ? { ok: false, error: null, message: "", aborted: true } : { ok: false, error: null, message };
}

function codeOf(body: unknown): string | null {
  return body !== null && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
    ? (body as { error: string }).error
    : null;
}

export async function extractText(
  file: File,
  options: { signal?: AbortSignal; fetch?: Fetch } = {},
): Promise<ExtractOutcome> {
  const form = new FormData();
  form.append("file", file);
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)("/api/extract", { method: "POST", body: form, signal: options.signal });
  } catch (err) {
    return failure(err, NETWORK_MESSAGE);
  }
  if (!response.ok) {
    const body = await readErrorBody(response);
    return { ok: false, error: codeOf(body), message: errorMessage("extract", response.status, body) };
  }
  const body = (await readErrorBody(response)) as { text?: unknown; source?: unknown } | null;
  if (!body || typeof body.text !== "string" || (body.source !== "pdf" && body.source !== "image")) {
    return { ok: false, error: null, message: GENERIC_MESSAGE };
  }
  return { ok: true, text: body.text, source: body.source };
}

/**
 * Sends the confirmed text unchanged (R1.6) and reads the progress stream.
 * Resolves with the result or a failure once the stream ends.
 */
export async function convertLetter(
  original: string,
  options: { onProgress?: (event: ProgressEvent) => void; signal?: AbortSignal; fetch?: Fetch } = {},
): Promise<ConvertOutcome> {
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)("/api/convert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ original }),
      signal: options.signal,
    });
  } catch (err) {
    return failure(err, NETWORK_MESSAGE);
  }
  if (!response.ok) {
    const body = await readErrorBody(response);
    return { ok: false, error: codeOf(body), message: errorMessage("convert", response.status, body) };
  }
  if (!response.body) return { ok: false, error: null, message: STREAM_BROKEN_MESSAGE };
  try {
    for await (const value of readNdjson(response.body)) {
      const event = parseConvertEvent(value);
      if (event === null) continue;
      if (event.type === "progress") options.onProgress?.(event);
      else if (event.type === "result") return { ok: true, result: event.result };
      else return { ok: false, error: event.error, message: errorMessage("convert", event.status, event) };
    }
  } catch (err) {
    return failure(err, STREAM_BROKEN_MESSAGE);
  }
  return { ok: false, error: null, message: STREAM_BROKEN_MESSAGE };
}
