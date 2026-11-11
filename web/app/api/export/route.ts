/**
 * POST /api/export: the Easy Read version as an A4 PDF (task 28, R8). All
 * logic is in `src/export`. The result comes in the body and goes to headless
 * Chromium in memory; nothing is stored or logged (R7.4).
 *
 * No `export const runtime = "nodejs"`: this app enables Cache Components,
 * which runs route handlers on Node.js by default and rejects any `runtime`
 * segment export.
 */
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
