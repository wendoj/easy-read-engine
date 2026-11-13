// No `runtime` export: Cache Components runs route handlers on Node.js and rejects the segment option.
import { handleExtract } from "@/src/extract";
import { createModelClient, loadModelConfig } from "@/src/llm";

export async function POST(request: Request): Promise<Response> {
  return handleExtract(request, {
    getClient: () => createModelClient({ config: loadModelConfig() }),
  });
}
