/**
 * Browser calls to `/api/extract`, `/api/convert`, `/api/check`, `/api/sample`, `/api/export` and `/api/access`. They return plain
 * outcomes, never throw for HTTP errors, and never log or store letter text
 * (R7.4).
 */
import { z } from "zod";
import type { AccessState } from "@/src/access/errors";
import type { ConversionResult, ProgressEvent } from "@/src/pipeline/types";
import { type SampleInfo, sampleInfoSchema } from "@/src/samples/sample";
import {
  GENERIC_MESSAGE,
  NETWORK_MESSAGE,
  STREAM_BROKEN_MESSAGE,
  errorMessage,
  readErrorBody,
} from "./api-errors";
import { conversionResultSchema, parseConvertEvent } from "./convert-events";
import { type CheckRequestBody, type CheckResponseBody, checkResponseSchema } from "./line-edit";
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

export type CheckOutcome = { ok: true; response: CheckResponseBody } | ApiFailure;

/** Re-checks the lines after an edit (R9.2). The body is sent as built, never logged. */
export async function checkEdit(
  body: CheckRequestBody,
  options: { signal?: AbortSignal; fetch?: Fetch } = {},
): Promise<CheckOutcome> {
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)("/api/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (err) {
    return failure(err, NETWORK_MESSAGE);
  }
  const parsedBody = await readErrorBody(response);
  if (!response.ok) {
    return { ok: false, error: codeOf(parsedBody), message: errorMessage("check", response.status, parsedBody) };
  }
  const parsed = checkResponseSchema.safeParse(parsedBody);
  if (!parsed.success) return { ok: false, error: null, message: GENERIC_MESSAGE };
  return { ok: true, response: parsed.data };
}

export type ExportOutcome = { ok: true; pdf: Blob } | ApiFailure;

/**
 * Sends the result on screen to `/api/export` and returns the PDF (R8.1). The
 * server checks P1 again and returns 409 if the result is blocked (R9.5). The
 * PDF stays in memory as a Blob until the browser saves it.
 */
export async function exportPdf(
  result: ConversionResult,
  options: { signal?: AbortSignal; fetch?: Fetch } = {},
): Promise<ExportOutcome> {
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)("/api/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(result),
      signal: options.signal,
    });
  } catch (err) {
    return failure(err, NETWORK_MESSAGE);
  }
  if (!response.ok) {
    const body = await readErrorBody(response);
    return { ok: false, error: codeOf(body), message: errorMessage("export", response.status, body) };
  }
  if (!(response.headers.get("content-type") ?? "").startsWith("application/pdf")) {
    return { ok: false, error: null, message: GENERIC_MESSAGE };
  }
  try {
    return { ok: true, pdf: await response.blob() };
  } catch (err) {
    return failure(err, NETWORK_MESSAGE);
  }
}

const sampleResponseSchema = z.object({
  result: conversionResultSchema,
  sample: sampleInfoSchema,
  judgeRecorded: z.literal(true),
});

export type SampleOutcome = { ok: true; result: ConversionResult; sample: SampleInfo } | ApiFailure;

/**
 * Loads a recorded sample letter. The server re-runs P1 to P8 through the
 * checker and makes no model call, so this spends no model quota.
 */
export async function loadSample(
  id: string,
  options: { signal?: AbortSignal; fetch?: Fetch } = {},
): Promise<SampleOutcome> {
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)("/api/sample", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
      signal: options.signal,
    });
  } catch (err) {
    return failure(err, NETWORK_MESSAGE);
  }
  const body = await readErrorBody(response);
  if (!response.ok) {
    return { ok: false, error: codeOf(body), message: errorMessage("sample", response.status, body) };
  }
  const parsed = sampleResponseSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: null, message: GENERIC_MESSAGE };
  return { ok: true, result: parsed.data.result, sample: parsed.data.sample };
}

const accessStateSchema = z.enum(["open", "granted", "denied", "closed"]);
const accessResponseSchema = z.object({ access: accessStateSchema });

export type AccessOutcome = { ok: true; access: AccessState } | ApiFailure;

/** Asks whether this browser may use the model routes (judge access key). */
export async function getAccess(options: { signal?: AbortSignal; fetch?: Fetch } = {}): Promise<AccessOutcome> {
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)("/api/access", { method: "GET", cache: "no-store", signal: options.signal });
  } catch (err) {
    return failure(err, NETWORK_MESSAGE);
  }
  const body = await readErrorBody(response);
  if (!response.ok) return { ok: false, error: codeOf(body), message: errorMessage("access", response.status, body) };
  const parsed = accessResponseSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: null, message: GENERIC_MESSAGE };
  return { ok: true, access: parsed.data.access };
}

/** Sends the judge access key. On a match the server sets an HttpOnly cookie. The key is never stored here. */
export async function sendAccessKey(
  key: string,
  options: { signal?: AbortSignal; fetch?: Fetch } = {},
): Promise<AccessOutcome> {
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)("/api/access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key }),
      signal: options.signal,
    });
  } catch (err) {
    return failure(err, NETWORK_MESSAGE);
  }
  const body = await readErrorBody(response);
  if (!response.ok) return { ok: false, error: codeOf(body), message: errorMessage("access", response.status, body) };
  const parsed = accessResponseSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: null, message: GENERIC_MESSAGE };
  return { ok: true, access: parsed.data.access };
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
