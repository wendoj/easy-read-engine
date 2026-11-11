/**
 * Uploaded file to text for the confirm step (R1.2 to R1.4, R1.6).
 *
 * Order: size, then type from magic bytes, then pdf.js or the vision model.
 * Size and type are checked before any model call.
 *
 * Nothing is stored (R7.4). The file and text live only in this call. Logs
 * hold the source type, the outcome code, the time and which provider and
 * model answered. Never the file name, file bytes or text.
 */
import { type ModelClient, ProviderChainError, ProviderRequestError } from "@/src/llm/client";
import { type PromptTemplate, loadPrompt } from "@/src/llm/prompts";
import { ModelOutputError, type StructuredOptions } from "@/src/llm/structured";
import { EXTRACT_ERRORS, type ExtractErrorCode, MAX_FILE_BYTES } from "./errors";
import { type FileKind, detectFileType } from "./file-type";
import { extractPdfText, tidyText } from "./pdf";
import { readImage } from "./vision";

export type ExtractSource = "pdf" | "image";

export type ExtractOutcome =
  | { ok: true; text: string; source: ExtractSource }
  | ExtractFailure;

export interface ExtractFailure {
  ok: false;
  error: ExtractErrorCode;
  status: number;
  message: string;
  retryAfterSeconds?: number;
}

/** Log event. Holds no file name, file content or extracted text. */
export interface ExtractLogEvent {
  msg: "extract";
  source?: ExtractSource;
  outcome: "ok" | ExtractErrorCode;
  provider?: string;
  model?: string;
  ms: number;
}

export interface ExtractDeps {
  /** Built only when a photo needs reading, so PDFs work without model config. */
  getClient: () => ModelClient;
  loadVisionPrompt?: () => Promise<PromptTemplate>;
  /** Wait used once before retrying after every provider failed with a `Retry-After`. */
  sleep?: (ms: number) => Promise<void>;
  logger?: (event: ExtractLogEvent) => void;
  structured?: StructuredOptions;
  now?: () => number;
}

const defaultLogger = (event: ExtractLogEvent) => console.info(JSON.stringify(event));
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function failure(error: ExtractErrorCode, retryAfterSeconds?: number): ExtractFailure {
  const { status, message } = EXTRACT_ERRORS[error];
  return { ok: false, error, status, message, ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) };
}

function sourceOf(kind: FileKind | null): ExtractSource | undefined {
  if (kind === null) return undefined;
  return kind === "pdf" ? "pdf" : "image";
}

export async function extractText(bytes: Uint8Array, deps: ExtractDeps): Promise<ExtractOutcome> {
  const log = deps.logger ?? defaultLogger;
  const now = deps.now ?? (() => performance.now());
  const start = now();
  let answeredBy: { provider: string; model: string } | undefined;

  const kind = bytes.length <= MAX_FILE_BYTES ? detectFileType(bytes) : null;
  const outcome = await run(kind);

  log({
    msg: "extract",
    ...(sourceOf(kind) ? { source: sourceOf(kind) } : {}),
    outcome: outcome.ok ? "ok" : outcome.error,
    ...(answeredBy ?? {}),
    ms: Math.round(now() - start),
  });
  return outcome;

  async function run(kind: FileKind | null): Promise<ExtractOutcome> {
    if (bytes.length > MAX_FILE_BYTES) return failure("too_large");
    if (kind === null) return failure("unsupported_type");

    if (kind === "pdf") {
      const pdf = await extractPdfText(bytes);
      if (pdf.kind === "text") return { ok: true, text: pdf.text, source: "pdf" };
      return failure(pdf.kind);
    }

    const prompt = await (deps.loadVisionPrompt ?? (() => loadPrompt("vision")))();
    const client = deps.getClient();
    const read = () => readImage(client, prompt, bytes, kind, deps.structured);
    try {
      let result;
      try {
        result = await read();
      } catch (err) {
        // Design "Error Handling": wait once for the shortest Retry-After (at most 20 s), then give up.
        if (!(err instanceof ProviderChainError) || err.retryAfterMs === undefined) throw err;
        await (deps.sleep ?? defaultSleep)(err.retryAfterMs);
        result = await read();
      }
      answeredBy = { provider: result.provider, model: result.model };
      const { handwritten, readable, text } = result.page;
      if (handwritten) return failure("handwriting");
      const tidy = tidyText(text);
      if (!readable || tidy.length === 0) return failure("unreadable");
      return { ok: true, text: tidy, source: "image" };
    } catch (err) {
      if (err instanceof ProviderChainError) {
        const seconds = err.retryAfterMs !== undefined ? Math.ceil(err.retryAfterMs / 1000) : undefined;
        return failure("providers_unavailable", seconds);
      }
      if (err instanceof ModelOutputError || err instanceof ProviderRequestError) {
        return failure("model_output_invalid");
      }
      throw err;
    }
  }
}
