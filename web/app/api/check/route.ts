// No `runtime` export: Cache Components runs route handlers on Node.js and rejects the segment option.
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
