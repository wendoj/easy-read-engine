/**
 * Line IDs and applying regeneration results. Only failing lines change;
 * every other line keeps its ID, text and place (design "Pipeline orchestrator").
 */
import type { Line, Sentence } from "@/src/checker-client/schemas";
import type { DraftLine, RegenerateResult } from "@/src/llm";

/** A line inside the pipeline. `symbolQuery` is kept for `attachSymbols`. */
export interface WorkingLine extends Line {
  symbolQuery: string;
}

/** Hands out line IDs L1, L2, ... that are never reused within a conversion. */
export class LineIds {
  private n = 0;
  next(): string {
    this.n += 1;
    return `L${this.n}`;
  }
}

function toWorking(draft: DraftLine, id: string, sourceSentenceId = draft.sourceSentenceId): WorkingLine {
  return { id, text: draft.text, source_sentence_id: sourceSentenceId, symbol_id: null, symbolQuery: draft.symbolQuery };
}

export function fromDrafts(drafts: readonly DraftLine[], ids: LineIds): WorkingLine[] {
  return drafts.map((d) => toWorking(d, ids.next()));
}

/** Plain `Line` objects, for the checker and the result. */
export function toLines(lines: readonly WorkingLine[]): Line[] {
  return lines.map(({ id, text, source_sentence_id, symbol_id }) => ({ id, text, source_sentence_id, symbol_id }));
}

/**
 * Apply a regenerate result:
 * - each failing line is replaced in place; the first replacement keeps the
 *   failing line's ID, any extra lines get new IDs; all keep its source sentence;
 * - a failing line with no replacement is left as it was;
 * - lines that weren't failing are not touched;
 * - added lines (for missing key facts) go after the last line whose source
 *   sentence comes no later than theirs in the Original.
 */
export function applyRegeneration(
  lines: readonly WorkingLine[],
  failing: ReadonlySet<string>,
  result: Pick<RegenerateResult, "replacements" | "added">,
  sentences: readonly Sentence[],
  ids: LineIds,
): WorkingLine[] {
  const byId = new Map(result.replacements.map((r) => [r.lineId, r.lines]));
  const out: WorkingLine[] = [];
  for (const line of lines) {
    const replacement = failing.has(line.id) ? byId.get(line.id) : undefined;
    if (!replacement || replacement.length === 0) {
      out.push(line);
      continue;
    }
    replacement.forEach((d, i) => out.push(toWorking(d, i === 0 ? line.id : ids.next(), line.source_sentence_id)));
  }
  const order = new Map(sentences.map((s, i) => [s.id, i]));
  const rank = (sentenceId: string) => order.get(sentenceId) ?? Number.MAX_SAFE_INTEGER;
  for (const draft of result.added) {
    const added = toWorking(draft, ids.next());
    const r = rank(added.source_sentence_id);
    let at = 0;
    out.forEach((l, i) => {
      if (rank(l.source_sentence_id) <= r) at = i + 1;
    });
    out.splice(at, 0, added);
  }
  return out;
}
