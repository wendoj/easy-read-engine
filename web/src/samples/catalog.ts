/**
 * The recorded samples, server side. Imported by the home page (for the list)
 * and by `/api/sample` (for the full result). Client code gets only
 * `SampleInfo` for the list, so the sample letters are never in the browser
 * bundle; a sample's text and lines are sent only when it is loaded.
 *
 * The files are imported statically through `web/data/samples/index.ts`, so
 * they are bundled at build time and need no file reads at run time. Each is
 * validated here; a broken sample file fails the build.
 */
import { SAMPLE_FILES } from "@/data/samples";
import { type SampleFile, type SampleInfo, sampleFileSchema, sampleInfo } from "./sample";

export interface SampleCatalog {
  list(): SampleInfo[];
  find(id: string): SampleFile | undefined;
}

export function createSampleCatalog(files: readonly unknown[]): SampleCatalog {
  const samples = files.map((f) => sampleFileSchema.parse(f));
  const ids = new Set<string>();
  for (const s of samples) {
    if (ids.has(s.id)) throw new Error(`Sample ID given twice: ${s.id}`);
    ids.add(s.id);
  }
  const byId = new Map(samples.map((s) => [s.id, s]));
  return {
    list: () => samples.map(sampleInfo),
    find: (id) => byId.get(id),
  };
}

let shared: SampleCatalog | null = null;

/** The samples in `web/data/samples/`, parsed once. */
export function sampleCatalog(): SampleCatalog {
  shared ??= createSampleCatalog(SAMPLE_FILES);
  return shared;
}
