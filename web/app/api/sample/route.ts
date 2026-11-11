/**
 * POST /api/sample: load a recorded sample letter and re-run P1 to P8 on it
 * through the checker (task 29). No model call, so it spends no model quota.
 * All logic is in `src/samples`.
 *
 * No `runtime` export: Cache Components runs route handlers on Node.js and
 * rejects the segment option (see app/api/check/route.ts).
 */
import { createCheckerClient } from "@/src/checker-client";
import { sampleCatalog } from "@/src/samples/catalog";
import { handleSample } from "@/src/samples/handler";

export async function POST(request: Request): Promise<Response> {
  return handleSample(request, { getChecker: () => createCheckerClient(), catalog: sampleCatalog() });
}
