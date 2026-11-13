/**
 * A line gets the checker's top match for its `symbolQuery` only when the
 * score is above `SYMBOL_MIN_SCORE`; otherwise `symbol_id` is `null`.
 * `CheckerUnavailable` is not caught, so the route returns 503.
 */
import type { SymbolMatch } from "@/src/checker-client/schemas";
import { SYMBOL_LOOKUP_CONCURRENCY, SYMBOL_MIN_SCORE } from "./config";
import type { WorkingLine } from "./lines";

/** A `CheckerClient` fits. */
export interface SymbolLookup {
  symbols(q: string, limit?: number): Promise<SymbolMatch[]>;
}

export interface AttachSymbolsOptions {
  minScore?: number;
  concurrency?: number;
}

function normaliseQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Run `task` on each item with at most `limit` in flight; stop starting new ones after a failure. */
async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  async function worker(): Promise<void> {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        out[i] = await task(items[i]);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker);
  await Promise.all(workers);
  return out;
}

export async function attachSymbols(
  lines: readonly WorkingLine[],
  checker: SymbolLookup,
  options: AttachSymbolsOptions = {},
): Promise<WorkingLine[]> {
  const minScore = options.minScore ?? SYMBOL_MIN_SCORE;
  const concurrency = options.concurrency ?? SYMBOL_LOOKUP_CONCURRENCY;

  const queries = [...new Set(lines.map((l) => normaliseQuery(l.symbolQuery)).filter((q) => q !== ""))];
  const tops = await mapLimit(queries, concurrency, async (q) => (await checker.symbols(q, 1))[0]);
  const chosen = new Map<string, string>();
  queries.forEach((q, i) => {
    const top = tops[i];
    if (top !== undefined && top.score > minScore) chosen.set(q, top.id);
  });

  return lines.map((l) => ({ ...l, symbol_id: chosen.get(normaliseQuery(l.symbolQuery)) ?? null }));
}
