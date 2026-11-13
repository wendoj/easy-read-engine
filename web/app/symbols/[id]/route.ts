// No `runtime` export: Cache Components runs route handlers on Node.js and rejects the segment option.
import { handleSymbolImage, symbolCacheDir } from "@/src/symbols/image";

export async function GET(_request: Request, ctx: RouteContext<"/symbols/[id]">): Promise<Response> {
  const { id } = await ctx.params;
  return handleSymbolImage(id, { cacheDir: symbolCacheDir() });
}
