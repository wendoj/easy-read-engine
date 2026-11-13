// No `runtime` export: Cache Components runs route handlers on Node.js and rejects the segment option.
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
