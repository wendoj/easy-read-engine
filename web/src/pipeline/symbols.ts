/**
 * Pipeline step 6: pick a pictogram for each line.
 *
 * Seam for task 23. For now every line gets `symbol_id: null`, so it shows
 * with no picture rather than a wrong one (R4.2). Task 23 fills this in with
 * `find_symbol` on `symbolQuery`, taking the top match only above a threshold.
 */
import type { WorkingLine } from "./lines";

export async function attachSymbols(lines: readonly WorkingLine[]): Promise<WorkingLine[]> {
  return lines.map((l) => ({ ...l, symbol_id: null }));
}
