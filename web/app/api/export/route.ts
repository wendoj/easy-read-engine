// No `runtime` export: Cache Components runs route handlers on Node.js and rejects the segment option.
import { createCheckerClient } from "@/src/checker-client";
import { cachedPictureLoader, createChromiumRenderer, handleExport, sharedExportQueue } from "@/src/export";

export async function POST(request: Request): Promise<Response> {
  return handleExport(request, {
    getChecker: () => createCheckerClient(),
    getRenderer: () => createChromiumRenderer(),
    queue: sharedExportQueue(),
    loadPicture: cachedPictureLoader(),
  });
}
