/**
 * Line spans come from the checker's `POST /line-facts`, which uses P1's own
 * normalisation, so this file never normalises a value and can't drift from P1.
 * Labels hold the fact type only, never the value.
 */
import type { KeyFact, LineFactSpan } from "@/src/checker-client/schemas";
import type { OriginalSegment } from "./result-layout";

export type KeyFactType = KeyFact["type"];

export interface FactSpan {
  factId: string;
  start: number;
  end: number;
}

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
 * Pieces cover `text[from:to]` exactly, with no gaps or empty pieces, and
 * adjacent pieces never share `factIds`. Spans may nest or overlap (an action
 * often holds a date), so each piece lists every covering fact, longest first.
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

export type HighlightedSegment = OriginalSegment & { pieces: HighlightPiece[] };

/** A fact outside every sentence is still highlighted; one across a segment edge is split there. */
export function highlightSegments(
  text: string,
  segments: readonly OriginalSegment[],
  keyFacts: readonly KeyFact[],
): HighlightedSegment[] {
  const spans: FactSpan[] = keyFacts.map((f) => ({ factId: f.id, start: f.start, end: f.end }));
  return segments.map((segment) => ({ ...segment, pieces: highlightPieces(text, segment.start, segment.end, spans) }));
}

/** A span for a fact not in `knownFactIds` is never shown. */
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

/** Palette order: one colour per fact type, so a colour always means the same kind of fact. */
export const FACT_TYPE_ORDER: readonly KeyFactType[] = ["date", "time", "money", "reference", "phone", "address", "action"];

/**
 * One colour per fact type, in `FACT_TYPE_ORDER`. No red (failures only) and
 * no blue (Ink Blue means "you can press this"). Each is a 100 fill with 950
 * text, above 12:1. Class strings are written out in full so Tailwind
 * generates them.
 */
export const FACT_PALETTE: readonly string[] = [
  "bg-yellow-100 text-yellow-950 decoration-yellow-700",
  "bg-orange-100 text-orange-950 decoration-orange-700",
  "bg-emerald-100 text-emerald-950 decoration-emerald-700",
  "bg-stone-200 text-stone-950 decoration-stone-600",
  "bg-purple-100 text-purple-950 decoration-purple-700",
  "bg-teal-100 text-teal-950 decoration-teal-700",
  "bg-fuchsia-100 text-fuchsia-950 decoration-fuchsia-700",
];

/**
 * A second signal besides colour. Actions are often whole phrases, so they
 * carry the fill only; an underline would clash with the explained-word underline.
 */
export const FACT_TYPE_UNDERLINE: Record<KeyFactType, string | null> = {
  date: "decoration-solid",
  time: "decoration-double",
  money: "decoration-dashed",
  reference: "decoration-dotted",
  phone: "decoration-wavy",
  address: "decoration-double",
  action: null,
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

export const FAILED_FACT_LABEL = "did not match";

/** Palette index per fact ID: the index of its type in `FACT_TYPE_ORDER`. */
export function factColours(keyFacts: readonly KeyFact[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const fact of keyFacts) {
    if (!out.has(fact.id)) out.set(fact.id, Math.max(0, FACT_TYPE_ORDER.indexOf(fact.type)));
  }
  return out;
}

export interface FactStyle {
  factId: string;
  type: KeyFactType;
  /** Index into `FACT_PALETTE`. */
  colour: number;
  failed: boolean;
  /** "date", or "date, did not match". Never the value. */
  label: string;
}

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

/** The innermost fact sets the colour and underline. */
export function pieceClassName(piece: HighlightPiece, styles: ReadonlyMap<string, FactStyle>): string | null {
  const id = piece.factIds.at(-1);
  const style = id === undefined ? undefined : styles.get(id);
  return style ? factClassName(style) : null;
}

export function factClassName(style: FactStyle): string {
  const underline = FACT_TYPE_UNDERLINE[style.type];
  const line = underline === null ? "" : ` underline decoration-2 underline-offset-4 ${underline}`;
  const base = `rounded-sm box-decoration-clone ${FACT_PALETTE[style.colour % FACT_PALETTE.length]}${line}`;
  return style.failed ? `${base} font-semibold ring-2 ring-destructive` : base;
}

/** Labels of every covering fact, innermost first. */
export function pieceTitle(piece: HighlightPiece, styles: ReadonlyMap<string, FactStyle>): string | undefined {
  const labels = [...piece.factIds].reverse().flatMap((id) => styles.get(id)?.label ?? []);
  return labels.length > 0 ? labels.join("; ") : undefined;
}
