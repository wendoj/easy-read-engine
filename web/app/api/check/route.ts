/**
 * POST /api/check: re-check the Easy Read lines after the user saves an edit
 * (R9.1 to R9.4). All logic is in `src/check`. Nothing is stored or logged (R7.4).
 *
 * No `export const runtime = "nodejs"`: this app enables Cache Components,
 * which runs route handlers on Node.js by default and rejects any `runtime`
 * segment export, including "nodejs" (see the Next.js 16 runtime docs).
 */
import { handleCheck } from "@/src/check";
import { createCheckerClient } from "@/src/checker-client";
import { createModelClient, loadModelConfig } from "@/src/llm";
import { modelFromClient } from "@/src/pipeline";

export async function POST(request: Request): Promise<Response> {
  return handleCheck(request, {
    getChecker: () => createCheckerClient(),
    getModel: () => modelFromClient(createModelClient({ config: loadModelConfig() })),
  });
}
