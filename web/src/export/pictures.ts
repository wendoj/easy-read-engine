/**
 * Pictograms for the PDF as PNG `data:` URIs, read on the server through the
 * same code as `GET /symbols/<id>` (cache first, ARASAAC on first use). The
 * print page then needs no network at all. The cache holds only pictograms
 * (R7.4).
 */
import { handleSymbolImage, symbolCacheDir } from "@/src/symbols/image";

/** A PNG data URI for the pictogram, or null when it can't be loaded. */
export type PictureLoader = (symbolId: string) => Promise<string | null>;

export function cachedPictureLoader(cacheDir: string = symbolCacheDir()): PictureLoader {
  return async (symbolId) => {
    try {
      const res = await handleSymbolImage(symbolId, { cacheDir });
      if (res.status !== 200) return null;
      const bytes = Buffer.from(await res.arrayBuffer());
      return `data:image/png;base64,${bytes.toString("base64")}`;
    } catch {
      return null;
    }
  };
}

/** Loads each distinct symbol ID once. IDs that fail are left out, so their rows get an empty slot. */
export async function loadPictures(
  symbolIds: readonly (string | null)[],
  loader: PictureLoader,
): Promise<Map<string, string>> {
  const ids = [...new Set(symbolIds.filter((id): id is string => id !== null))];
  const loaded = await Promise.all(ids.map(async (id) => [id, await loader(id)] as const));
  return new Map(loaded.filter((entry): entry is readonly [string, string] => entry[1] !== null));
}
