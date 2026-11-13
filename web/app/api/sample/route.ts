// No `runtime` export: Cache Components runs route handlers on Node.js and rejects the segment option.
// No model call, so it spends no model quota.
import { createCheckerClient } from "@/src/checker-client";
import { sampleCatalog } from "@/src/samples/catalog";
import { handleSample } from "@/src/samples/handler";

export async function POST(request: Request): Promise<Response> {
  return handleSample(request, { getChecker: () => createCheckerClient(), catalog: sampleCatalog() });
}
