/** Browser calls to the API routes. They never throw for HTTP errors and never log or store letter text. */
import { z } from "zod";
import type { AccessState } from "@/src/access/errors";
import type { ConversionResult, ProgressEvent } from "@/src/pipeline/types";
import { type SampleInfo, sampleInfoSchema } from "@/src/samples/sample";
import {
  type ApiRoute,
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
type RequestOptions = { signal?: AbortSignal; fetch?: Fetch };

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

function httpFailure(route: ApiRoute, status: number, body: unknown): ApiFailure {
  return { ok: false, error: codeOf(body), message: errorMessage(route, status, body) };
}

function jsonPost(body: unknown): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

/** A network error or abort becomes a failure instead of a throw. */
async function send(
  url: string,
  init: RequestInit,
  options: RequestOptions,
): Promise<{ ok: true; response: Response } | ApiFailure> {
  try {
    return { ok: true, response: await (options.fetch ?? fetch)(url, { ...init, signal: options.signal }) };
  } catch (err) {
    return failure(err, NETWORK_MESSAGE);
  }
}

export async function extractText(file: File, options: RequestOptions = {}): Promise<ExtractOutcome> {
  const form = new FormData();
  form.append("file", file);
  const sent = await send("/api/extract", { method: "POST", body: form }, options);
  if (!sent.ok) return sent;
  const { response } = sent;
  if (!response.ok) return httpFailure("extract", response.status, await readErrorBody(response));
  const body = (await readErrorBody(response)) as { text?: unknown; source?: unknown } | null;
  if (!body || typeof body.text !== "string" || (body.source !== "pdf" && body.source !== "image")) {
    return { ok: false, error: null, message: GENERIC_MESSAGE };
  }
  return { ok: true, text: body.text, source: body.source };
}

export type CheckOutcome = { ok: true; response: CheckResponseBody } | ApiFailure;

export async function checkEdit(body: CheckRequestBody, options: RequestOptions = {}): Promise<CheckOutcome> {
  const sent = await send("/api/check", jsonPost(body), options);
  if (!sent.ok) return sent;
  const { response } = sent;
  const parsedBody = await readErrorBody(response);
  if (!response.ok) return httpFailure("check", response.status, parsedBody);
  const parsed = checkResponseSchema.safeParse(parsedBody);
  if (!parsed.success) return { ok: false, error: null, message: GENERIC_MESSAGE };
  return { ok: true, response: parsed.data };
}

export type ExportOutcome = { ok: true; pdf: Blob } | ApiFailure;

/** The server checks P1 again and returns 409 for a blocked result. */
export async function exportPdf(result: ConversionResult, options: RequestOptions = {}): Promise<ExportOutcome> {
  const sent = await send("/api/export", jsonPost(result), options);
  if (!sent.ok) return sent;
  const { response } = sent;
  if (!response.ok) return httpFailure("export", response.status, await readErrorBody(response));
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

/** The server re-runs P1 to P8 and makes no model call. */
export async function loadSample(id: string, options: RequestOptions = {}): Promise<SampleOutcome> {
  const sent = await send("/api/sample", jsonPost({ id }), options);
  if (!sent.ok) return sent;
  const { response } = sent;
  const body = await readErrorBody(response);
  if (!response.ok) return httpFailure("sample", response.status, body);
  const parsed = sampleResponseSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: null, message: GENERIC_MESSAGE };
  return { ok: true, result: parsed.data.result, sample: parsed.data.sample };
}

const accessStateSchema = z.enum(["open", "granted", "denied", "closed"]);
const accessResponseSchema = z.object({ access: accessStateSchema });

export type AccessOutcome = { ok: true; access: AccessState } | ApiFailure;

async function accessOutcome(response: Response): Promise<AccessOutcome> {
  const body = await readErrorBody(response);
  if (!response.ok) return httpFailure("access", response.status, body);
  const parsed = accessResponseSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: null, message: GENERIC_MESSAGE };
  return { ok: true, access: parsed.data.access };
}

export async function getAccess(options: RequestOptions = {}): Promise<AccessOutcome> {
  const sent = await send("/api/access", { method: "GET", cache: "no-store" }, options);
  return sent.ok ? accessOutcome(sent.response) : sent;
}

/** On a match the server sets an HttpOnly cookie. The key is never stored here. */
export async function sendAccessKey(key: string, options: RequestOptions = {}): Promise<AccessOutcome> {
  const sent = await send("/api/access", jsonPost({ key }), options);
  return sent.ok ? accessOutcome(sent.response) : sent;
}

/** Sends the confirmed text unchanged and reads the progress stream until a result or an error. */
export async function convertLetter(
  original: string,
  options: RequestOptions & { onProgress?: (event: ProgressEvent) => void } = {},
): Promise<ConvertOutcome> {
  const sent = await send("/api/convert", jsonPost({ original }), options);
  if (!sent.ok) return sent;
  const { response } = sent;
  if (!response.ok) return httpFailure("convert", response.status, await readErrorBody(response));
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
