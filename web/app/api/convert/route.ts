/**
 * POST /api/convert: the confirmed text to a checked Easy Read version,
 * streamed as newline-delimited JSON (R1.6, R1.7, R3.1). All logic is in
 * `src/convert`. Nothing is stored or logged (R7.4).
 *
 * No `export const runtime = "nodejs"`: this app enables Cache Components,
 * which runs route handlers on Node.js by default and rejects any `runtime`
 * segment export, including "nodejs" (see the Next.js 16 runtime docs).
 */
import { createCheckerClient } from "@/src/checker-client";
import { handleConvert } from "@/src/convert";
import { createModelClient, loadModelConfig } from "@/src/llm";
import { modelFromClient } from "@/src/pipeline";

export async function POST(request: Request): Promise<Response> {
  return handleConvert(request, {
    getChecker: () => createCheckerClient(),
    getModel: () => modelFromClient(createModelClient({ config: loadModelConfig() })),
  });
}
