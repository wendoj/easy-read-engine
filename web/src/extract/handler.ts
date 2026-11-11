/**
 * `POST /api/extract` as a plain `Request -> Response` function, so tests can
 * call it without Next.js. The route file only wires in the real model client.
 *
 * Input: multipart form data with 1 field, `file`.
 * Output: `{ text, source }`, or `{ error, message }` with the status from
 * `EXTRACT_ERRORS`. Responses are never cached.
 */
import { z } from "zod";
import { type RateLimiter, rateLimit as defaultRateLimit } from "@/src/rate-limit";
import { MAX_FILE_BYTES } from "./errors";
import { type ExtractDeps, type ExtractFailure, extractText, failure } from "./extract";

/** Room for the multipart boundary and part headers around the file. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const formSchema = z.object({
  file: z
    .array(z.instanceof(File))
    .length(1)
    .transform((files) => files[0]),
});

export interface ExtractHandlerDeps extends ExtractDeps {
  rateLimit?: RateLimiter;
}

const NO_STORE = { "cache-control": "no-store" };

function errorResponse(outcome: ExtractFailure): Response {
  const headers: Record<string, string> = { ...NO_STORE };
  if (outcome.retryAfterSeconds !== undefined) headers["retry-after"] = String(outcome.retryAfterSeconds);
  return Response.json({ error: outcome.error, message: outcome.message }, { status: outcome.status, headers });
}

export async function handleExtract(request: Request, deps: ExtractHandlerDeps): Promise<Response> {
  const limit = await (deps.rateLimit ?? defaultRateLimit)(request, "extract");
  if (!limit.allowed) {
    const headers: Record<string, string> = { ...NO_STORE };
    if (limit.retryAfterSeconds !== undefined) headers["retry-after"] = String(limit.retryAfterSeconds);
    return Response.json({ error: limit.code, message: limit.message }, { status: limit.status, headers });
  }

  // Reject a body that is clearly too big before reading it.
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return errorResponse(failure("too_large"));
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse(failure("invalid_request"));
  }
  const parsed = formSchema.safeParse({ file: form.getAll("file") });
  if (!parsed.success) {
    return errorResponse(failure("invalid_request"));
  }
  const { file } = parsed.data;
  if (file.size > MAX_FILE_BYTES) {
    return errorResponse(failure("too_large"));
  }

  const outcome = await extractText(new Uint8Array(await file.arrayBuffer()), deps);
  if (!outcome.ok) return errorResponse(outcome);
  return Response.json({ text: outcome.text, source: outcome.source }, { headers: NO_STORE });
}
