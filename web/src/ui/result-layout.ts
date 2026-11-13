// The Original is only ever sliced, never rewritten, so it shows exactly as confirmed.
import type { Line, Sentence } from "@/src/checker-client/schemas";
import type { ConversionResult, Rule, Status } from "@/src/pipeline/types";
import {
  type FactStyle,
  type HighlightPiece,
  type HighlightedSegment,
  factStyles,
  highlightSegments,
  linePieces,
} from "./key-fact-highlight";
import { lineMarkers } from "./rule-report";

export type OriginalSegment =
  | { kind: "text"; start: number; end: number; text: string }
  | { kind: "sentence"; start: number; end: number; text: string; sentenceId: string };

/**
 * Segments cover the Original exactly, in order, with no gaps, overlaps or
 * empty segments. Out-of-range spans are clamped, and a span that overlaps an
 * earlier one keeps only the part after it.
 */
export function originalSegments(text: string, sentences: readonly Sentence[]): OriginalSegment[] {
  const length = text.length;
  const clamp = (n: number) => Math.max(0, Math.min(n, length));
  const spans = sentences
    .filter((s) => Number.isInteger(s.start) && Number.isInteger(s.end))
    .map((s, index) => ({ id: s.id, start: clamp(s.start), end: clamp(s.end), index }))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.index - b.index);

  const segments: OriginalSegment[] = [];
  let cursor = 0;
  for (const span of spans) {
    const start = Math.max(span.start, cursor);
    if (span.end <= start) continue;
    if (start > cursor) segments.push({ kind: "text", start: cursor, end: start, text: text.slice(cursor, start) });
    segments.push({ kind: "sentence", start, end: span.end, text: text.slice(start, span.end), sentenceId: span.id });
    cursor = span.end;
  }
  if (cursor < length) segments.push({ kind: "text", start: cursor, end: length, text: text.slice(cursor) });
  return segments;
}

/** Null when the line isn't in `lines` or its source sentence isn't one of `sentences`. */
export function sentenceIdForLine(
  lineId: string,
  lines: readonly Line[],
  sentences: readonly Sentence[],
): string | null {
  const line = lines.find((l) => l.id === lineId);
  if (!line) return null;
  return sentences.some((s) => s.id === line.source_sentence_id) ? line.source_sentence_id : null;
}

export function symbolSrc(symbolId: string): string {
  return `/symbols/${encodeURIComponent(symbolId)}`;
}

export interface LineRow {
  id: string;
  text: string;
  symbolSrc: string | null;
  /** Null when the source sentence isn't in the Original; selecting the line then highlights nothing. */
  sourceSentenceId: string | null;
  flagged: boolean;
  /** In rule order. */
  failedRules: Rule[];
  /** Joining the piece texts gives `text`. */
  pieces: HighlightPiece[];
}

export interface ResultLayout {
  status: Status;
  /** Blocked: no lines are shown. */
  withheld: boolean;
  segments: HighlightedSegment[];
  rows: LineRow[];
  /** Shared by both columns, so each fact has the same colour in each. */
  factStyles: Map<string, FactStyle>;
}

export function resultLayout(result: ConversionResult): ResultLayout {
  const { text, sentences } = result.original;
  const segments = highlightSegments(text, originalSegments(text, sentences), result.keyFacts);
  const failedFactIds = result.checks.find((c) => c.rule === "P1")?.failed_fact_ids ?? [];
  const styles = factStyles(result.keyFacts, failedFactIds);
  if (result.status === "blocked") {
    // The server sends no lines when blocked; never show any even if some arrive.
    // The Original keeps its highlights, with failed facts marked.
    return { status: result.status, withheld: true, segments, rows: [], factStyles: styles };
  }
  const markers = lineMarkers(result);
  const sentenceIds = new Set(sentences.map((s) => s.id));
  const factIds = new Set(styles.keys());
  const rows = result.lines.map((line) => {
    const failedRules = markers.get(line.id) ?? [];
    return {
      id: line.id,
      text: line.text,
      symbolSrc: line.symbol_id === null ? null : symbolSrc(line.symbol_id),
      sourceSentenceId: sentenceIds.has(line.source_sentence_id) ? line.source_sentence_id : null,
      flagged: failedRules.length > 0,
      failedRules,
      pieces: linePieces(line.id, line.text, result.lineFacts, factIds),
    };
  });
  return { status: result.status, withheld: false, segments, rows, factStyles: styles };
}

/**
 * The container `scrollTop` that puts the element about a third of the way
 * down, or the current one when it is already fully visible. Positions are
 * viewport coordinates from `getBoundingClientRect`.
 */
export function scrollTopToReveal(
  container: { top: number; height: number; scrollTop: number },
  element: { top: number; height: number },
): number {
  const offset = element.top - container.top;
  if (offset >= 0 && offset + element.height <= container.height) return container.scrollTop;
  return Math.max(0, container.scrollTop + offset - container.height / 3);
}
