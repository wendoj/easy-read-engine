/**
 * Key-fact highlighting for the result screen (task 25, R5.3).
 *
 * - The Original: each segment from `originalSegments` is split further at the
 *   key-fact spans from `analyse`. Pieces are slices of the Original, so their
 *   texts join back to it exactly (R1.6).
 * - The Easy Read lines: spans come from the checker's `POST /line-facts`
 *   (`ConversionResult.lineFacts`). The checker matches line values to facts
 *   with P1's own extraction and normalisation, so this file never normalises
 *   a value and can't drift from P1.
 *
 * One colour per fact, the same in both columns. Facts with the same type and
 * normalised value are the same fact to P1, so they share a colour. Colour is
 * never the only signal: each type has its own underline style, and every
 * highlight carries a type label for screen readers and as a tooltip.
 *
 * Nothing here logs, and labels hold the fact type only, never the value (R7.4).
 */
import type { KeyFact, LineFactSpan } from "@/src/checker-client/schemas";
import type { OriginalSegment } from "./result-layout";

export type KeyFactType = KeyFact["type"];

/** A fact's place in a text: offsets into that text. */
export interface FactSpan {
  factId: string;
  start: number;
  end: number;
}

/** A run of text with the facts that cover it. */
export interface HighlightPiece {
  start: number;
  end: number;
  text: string;
  /** Facts covering this piece, outermost first. Empty for plain text. The last one sets the colour. */
  factIds: string[];
  /** Facts whose span ends with this piece, innermost first. Their labels go after the piece. */
  endingFactIds: string[];
}

/**
 * Splits `text[from:to]` at the fact spans. The pieces cover the range
 * exactly, in order, with no gaps, overlaps or empty pieces, and adjacent
 * pieces never have the same `factIds`.
 *
 * Spans are clamped to the range; empty ones are dropped. Spans may nest or
 * overlap (an action often holds a date or an amount): each piece lists every
 * fact that covers it, longest span first.
 */
export function highlightPieces(text: string, from: number, to: number, spans: readonly FactSpan[]): HighlightPiece[] {
  const lo = Math.max(0, Math.min(from, text.length));
  const hi = Math.max(lo, Math.min(to, text.length));
  if (hi === lo) return [];
  const clamp = (n: number) => Math.max(lo, Math.min(n, hi));
  const inRange = spans
    .filter((s) => Number.isInteger(s.start) && Number.isInteger(s.end))
    .map((s) => ({ factId: s.factId, start: clamp(s.start), end: clamp(s.end) }))
    .filter((s) => s.end > s.start);

  const cuts = [...new Set([lo, hi, ...inRange.flatMap((s) => [s.start, s.end])])].sort((a, b) => a - b);
  const pieces: HighlightPiece[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [a, b] = [cuts[i], cuts[i + 1]];
    const covering = inRange
      .filter((s) => s.start <= a && s.end >= b)
      .sort((x, y) => y.end - y.start - (x.end - x.start) || x.start - y.start || x.factId.localeCompare(y.factId));
    const factIds = [...new Set(covering.map((s) => s.factId))];
    const prev = pieces.at(-1);
    if (prev && sameIds(prev.factIds, factIds)) {
      prev.end = b;
      prev.text = text.slice(prev.start, b);
    } else {
      pieces.push({ start: a, end: b, text: text.slice(a, b), factIds, endingFactIds: [] });
    }
  }
  for (const piece of pieces) {
    const ending = inRange.filter((s) => s.end === piece.end && piece.factIds.includes(s.factId)).map((s) => s.factId);
    piece.endingFactIds = piece.factIds.filter((id) => ending.includes(id)).reverse();
  }
  return pieces;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** A segment of the Original with its key-fact pieces. */
export type HighlightedSegment = OriginalSegment & { pieces: HighlightPiece[] };

/**
 * Splits every Original segment (sentences and the text between them) at the
 * key-fact spans. A fact outside every sentence is still highlighted, in the
 * text segment it falls in. A fact across a segment edge is split there.
 */
export function highlightSegments(
  text: string,
  segments: readonly OriginalSegment[],
  keyFacts: readonly KeyFact[],
): HighlightedSegment[] {
  const spans: FactSpan[] = keyFacts.map((f) => ({ factId: f.id, start: f.start, end: f.end }));
  return segments.map((segment) => ({ ...segment, pieces: highlightPieces(text, segment.start, segment.end, spans) }));
}

/**
 * Pieces of one Easy Read line. Only spans for this line and for facts in
 * `knownFactIds` are used, so a span for an unknown fact is never shown.
 */
export function linePieces(
  lineId: string,
  text: string,
  lineFacts: readonly LineFactSpan[],
  knownFactIds: ReadonlySet<string>,
): HighlightPiece[] {
  const spans = lineFacts
    .filter((s) => s.line_id === lineId && knownFactIds.has(s.fact_id))
    .map((s) => ({ factId: s.fact_id, start: s.start, end: s.end }));
  return highlightPieces(text, 0, text.length, spans);
}

// --- colours -------------------------------------------------------------------

/**
 * Fixed palette after the Okabe-Ito colour-blind-safe set: orange, sky blue,
 * bluish green, yellow, blue, vermilion and reddish purple. Light tints carry
 * near-black text and dark tints carry near-white text, so contrast stays well
 * above 4.5:1 in both themes. The class strings are written out in full so
 * Tailwind generates them.
 */
export const FACT_PALETTE: readonly string[] = [
  "bg-orange-100 text-orange-950 decoration-orange-700 dark:bg-orange-900/70 dark:text-orange-50 dark:decoration-orange-300",
  "bg-sky-100 text-sky-950 decoration-sky-700 dark:bg-sky-900/70 dark:text-sky-50 dark:decoration-sky-300",
  "bg-emerald-100 text-emerald-950 decoration-emerald-700 dark:bg-emerald-900/70 dark:text-emerald-50 dark:decoration-emerald-300",
  "bg-yellow-100 text-yellow-950 decoration-yellow-700 dark:bg-yellow-900/70 dark:text-yellow-50 dark:decoration-yellow-300",
  "bg-blue-100 text-blue-950 decoration-blue-700 dark:bg-blue-900/70 dark:text-blue-50 dark:decoration-blue-300",
  "bg-red-100 text-red-950 decoration-red-700 dark:bg-red-900/70 dark:text-red-50 dark:decoration-red-300",
  "bg-fuchsia-100 text-fuchsia-950 decoration-fuchsia-700 dark:bg-fuchsia-900/70 dark:text-fuchsia-50 dark:decoration-fuchsia-300",
];

/** A second signal besides colour: each type has its own underline style. */
export const FACT_TYPE_UNDERLINE: Record<KeyFactType, string> = {
  date: "decoration-solid",
  time: "decoration-double",
  money: "decoration-dashed",
  reference: "decoration-dotted",
  phone: "decoration-wavy",
  address: "decoration-solid",
  action: "decoration-dotted",
};

export const FACT_TYPE_LABELS: Record<KeyFactType, string> = {
  date: "date",
  time: "time",
  money: "amount",
  reference: "reference number",
  phone: "phone number",
  address: "address",
  action: "action",
};

/** Label suffix for a key fact P1 couldn't find unchanged in the Easy Read version. */
export const FAILED_FACT_LABEL = "did not match";

/**
 * A palette index per fact ID. Facts are taken in order of where they start
 * in the Original; each new (type, normalised value) gets the next colour,
 * cycling when there are more facts than colours. Facts with the same type and
 * value share a colour, because P1 treats them as one fact.
 */
export function factColours(keyFacts: readonly KeyFact[], paletteSize: number = FACT_PALETTE.length): Map<string, number> {
  const size = Math.max(1, Math.floor(paletteSize));
  const byKey = new Map<string, number>();
  const out = new Map<string, number>();
  const ordered = keyFacts
    .map((fact, index) => ({ fact, index }))
    .sort((a, b) => a.fact.start - b.fact.start || a.index - b.index);
  for (const { fact } of ordered) {
    if (out.has(fact.id)) continue;
    const key = `${fact.type}\u0000${fact.normalised}`;
    let colour = byKey.get(key);
    if (colour === undefined) {
      colour = byKey.size % size;
      byKey.set(key, colour);
    }
    out.set(fact.id, colour);
  }
  return out;
}

/** How one fact is drawn. The same object is used in both columns. */
export interface FactStyle {
  factId: string;
  type: KeyFactType;
  /** Index into `FACT_PALETTE`. */
  colour: number;
  /** True when P1 names this fact as failed. Task 27 builds on this for the blocked state. */
  failed: boolean;
  /** "date", or "date, did not match". Never the value. */
  label: string;
}

/** Styles for every key fact, keyed by fact ID. `failedFactIds` come from the P1 result. */
export function factStyles(keyFacts: readonly KeyFact[], failedFactIds: readonly string[]): Map<string, FactStyle> {
  const colours = factColours(keyFacts);
  const failed = new Set(failedFactIds);
  const out = new Map<string, FactStyle>();
  for (const fact of keyFacts) {
    if (out.has(fact.id)) continue;
    const isFailed = failed.has(fact.id);
    const type = FACT_TYPE_LABELS[fact.type];
    out.set(fact.id, {
      factId: fact.id,
      type: fact.type,
      colour: colours.get(fact.id) ?? 0,
      failed: isFailed,
      label: isFailed ? `${type}, ${FAILED_FACT_LABEL}` : type,
    });
  }
  return out;
}

/** Tailwind classes for a piece: the innermost fact sets the colour and underline. */
export function pieceClassName(piece: HighlightPiece, styles: ReadonlyMap<string, FactStyle>): string | null {
  const id = piece.factIds.at(-1);
  const style = id === undefined ? undefined : styles.get(id);
  if (!style) return null;
  const base = `rounded-sm underline decoration-2 underline-offset-4 ${FACT_PALETTE[style.colour % FACT_PALETTE.length]} ${FACT_TYPE_UNDERLINE[style.type]}`;
  return style.failed ? `${base} font-semibold ring-2 ring-destructive` : base;
}

/** Tooltip for a piece: the labels of every fact covering it, innermost first. */
export function pieceTitle(piece: HighlightPiece, styles: ReadonlyMap<string, FactStyle>): string | undefined {
  const labels = [...piece.factIds].reverse().flatMap((id) => styles.get(id)?.label ?? []);
  return labels.length > 0 ? labels.join("; ") : undefined;
}
