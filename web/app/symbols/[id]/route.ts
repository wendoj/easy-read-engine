/**
 * GET /symbols/<id>: an ARASAAC pictogram PNG, fetched once and then served
 * from the `symbol-cache` directory (`SYMBOL_CACHE_DIR`). All logic is in
 * `src/symbols/image.ts`.
 *
 * No `export const runtime = "nodejs"`: this app enables Cache Components,
 * which runs route handlers on Node.js by default and rejects any `runtime`
 * segment export.
 */
import { handleSymbolImage, symbolCacheDir } from "@/src/symbols/image";

export async function GET(_request: Request, ctx: RouteContext<"/symbols/[id]">): Promise<Response> {
  const { id } = await ctx.params;
  return handleSymbolImage(id, { cacheDir: symbolCacheDir() });
}
