// Server only. Client code imports `./errors` and `./print-document` directly.
import { type ExportQueue, createExportQueue } from "./queue";

export * from "./errors";
export * from "./queue";
export * from "./chromium";
export * from "./pictures";
export * from "./print-document";
export * from "./print-html";
export * from "./handler";

const SHARED = Symbol.for("easy-read.export-queue");

/** 1 export queue per server process, shared by route bundles and `next dev` reloads. */
export function sharedExportQueue(): ExportQueue {
  const store = globalThis as unknown as Record<symbol, ExportQueue | undefined>;
  return (store[SHARED] ??= createExportQueue());
}
