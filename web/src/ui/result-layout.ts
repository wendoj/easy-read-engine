/**
 * Pure helpers behind the result screen (task 22, R5.1, R5.2).
 *
 * The Original is rendered by slicing its text at the sentence spans from
 * `analyse`, so every character, including whitespace and line breaks, is
 * shown exactly as confirmed (R1.6). Nothing here rewrites the Original.
 */
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

/** A run of the Original: either a sentence from `analyse`, or text between sentences. */
export type OriginalSegment =
  | { kind: "text"; start: number; end: number; text: string }
  | { kind: "sentence"; start: number; end: number; text: string; sentenceId: string };

/**
 * Splits the Original into segments that cover it exactly, in order, with no
 * gaps, overlaps or empty segments. Joining the segment texts gives back the
 * Original.
 *
 * Spans are used as given when they are in range and don't overlap. Otherwise
 * they are clamped to the text, and a span that overlaps an earlier one keeps
 * only the part after it. A span with nothing left is dropped.
 *
 * `highlightSegments` (key-fact-highlight.ts) splits these further at key-fact spans.
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

/**
 * The ID of the Original sentence a line came from, or null when the line
 * isn't in `lines` or its source sentence isn't one of `sentences`.
 */
export function sentenceIdForLine(
  lineId: string,
  lines: readonly Line[],
  sentences: readonly Sentence[],
): string | null {
  const line = lines.find((l) => l.id === lineId);
  if (!line) return null;
  return sentences.some((s) => s.id === line.source_sentence_id) ? line.source_sentence_id : null;
}

/** URL of a pictogram served by the symbols route (task 23). */
export function symbolSrc(symbolId: string): string {
  return `/symbols/${encodeURIComponent(symbolId)}`;
}

/** One row on the Easy Read side: picture, then line. */
export interface LineRow {
  id: string;
  text: string;
  /** Null when the line has no picture. The row keeps an empty picture slot so lines stay aligned. */
  symbolSrc: string | null;
  /** Null when the source sentence isn't in the Original; selecting the line then highlights nothing. */
  sourceSentenceId: string | null;
  /** True when a failed rule names this line. */
  flagged: boolean;
  /** The failed rules that name this line, in rule order (task 24). */
  failedRules: Rule[];
  /** The line text split at its key facts (task 25). Joining the piece texts gives `text`. */
  pieces: HighlightPiece[];
}

export interface ResultLayout {
  status: Status;
  /** True when the output is blocked: no lines are shown (R2.5). Task 27 builds the full blocked state. */
  withheld: boolean;
  /** The Original split at sentences, then at key facts (task 25). */
  segments: HighlightedSegment[];
  rows: LineRow[];
  /** Colour, type label and failed flag per key fact ID, shared by both columns (R5.3). */
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
 * The `scrollTop` that brings an element into view inside a scroll container,
 * about a third of the way down. Returns the current `scrollTop` when the
 * element is already fully visible. Positions are viewport coordinates, as
 * from `getBoundingClientRect`.
 *
 * Scrolling only the container keeps the page still, so the selected line
 * stays where the user is looking.
 */
export function scrollTopToReveal(
  container: { top: number; height: number; scrollTop: number },
  element: { top: number; height: number },
): number {
  const offset = element.top - container.top;
  if (offset >= 0 && offset + element.height <= container.height) return container.scrollTop;
  return Math.max(0, container.scrollTop + offset - container.height / 3);
}
