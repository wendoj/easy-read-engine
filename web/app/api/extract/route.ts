/**
 * POST /api/extract: an uploaded PDF or photo to text for the confirm step (R1.2 to R1.4).
 * All logic is in `src/extract`. Nothing is stored or logged (R7.4).
 *
 * No `export const runtime = "nodejs"`: this app enables Cache Components,
 * which runs route handlers on Node.js by default and rejects any `runtime`
 * segment export, including "nodejs" (see the Next.js 16 runtime docs).
 */
import { handleExtract } from "@/src/extract";
import { createModelClient, loadModelConfig } from "@/src/llm";

export async function POST(request: Request): Promise<Response> {
  return handleExtract(request, {
    getClient: () => createModelClient({ config: loadModelConfig() }),
  });
}
