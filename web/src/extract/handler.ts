/**
 * `POST /api/extract`: multipart form with 1 `file` field, returns
 * `{ text, source }`. Access is checked first, then the rate limit.
 */
import { z } from "zod";
import { type AccessGate, requireAccess } from "@/src/access/key";
import { NO_STORE, errorResponse, rateLimitFailure } from "@/src/http/response";
import { type RateLimiter, rateLimit as defaultRateLimit } from "@/src/rate-limit";
import { MAX_FILE_BYTES } from "./errors";
import { type ExtractDeps, extractText, failure } from "./extract";

/** Room for the multipart boundary and part headers around the file. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const formSchema = z.object({
  file: z
    .array(z.instanceof(File))
    .length(1)
    .transform((files) => files[0]),
});

export interface ExtractHandlerDeps extends ExtractDeps {
  /** Judge access check. Runs first, so a denied request costs no rate-limit units. */
  access?: AccessGate;
  rateLimit?: RateLimiter;
}

export async function handleExtract(request: Request, deps: ExtractHandlerDeps): Promise<Response> {
  const denied = (deps.access ?? requireAccess)(request);
  if (denied) return errorResponse(failure(denied.error));

  const limit = await (deps.rateLimit ?? defaultRateLimit)(request, "extract");
  if (!limit.allowed) {
    return errorResponse(rateLimitFailure(limit));
  }

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
