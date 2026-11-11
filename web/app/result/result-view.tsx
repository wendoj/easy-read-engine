"use client";
/**
 * Side-by-side result screen (task 22, R5.1, R5.2, R7.1).
 *
 * The Original is on the left and the Easy Read lines are on the right, with a
 * picture to the left of each line. Selecting a line highlights the sentence
 * it came from. The safety notice is always at the top and can't be closed.
 *
 * The result comes from `useConversion()`. It is never stored, so after a
 * reload there is nothing to show (R7.4).
 *
 * Seams for later tasks:
 * - Pictures load from `/symbols/<id>` (task 23); `ResultFooter` shows the ARASAAC attribution (R4.4).
 * - Task 24: `RuleReport` shows the pass count and opens the report; flagged lines name their failed rules.
 * - Task 25: `FactText` highlights key facts in both columns, one colour per fact (R5.3).
 *   Failed key facts in the Original get a red ring, also when blocked; task 27 builds on this.
 * - Task 26: Edit and "Undo edit" go in `LineRow`'s actions slot; edits replace the result in context.
 * - Task 27: the full blocked state replaces `WithheldMessage`.
 * - Task 28: the Export button goes in the toolbar, disabled when blocked.
 */
import Image from "next/image";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ARASAAC_ATTRIBUTION_PARTS } from "@/src/symbols/attribution";
import { useConversion } from "@/src/ui/conversion-context";
import { lineMarkerLabel } from "@/src/ui/rule-report";
import {
  type FactStyle,
  type HighlightPiece,
  type HighlightedSegment,
  pieceClassName,
  pieceTitle,
} from "@/src/ui/key-fact-highlight";
import { type LineRow as LineRowData, resultLayout, scrollTopToReveal } from "@/src/ui/result-layout";
import { cn } from "cn";
import { RuleReport } from "./rule-report";

const PICTURE_SIZE = 64;

export const WITHHELD_MESSAGE =
  "The Easy Read version was withheld because a key fact did not match the letter.";

function BackLink() {
  return (
    <Link href="/" className={buttonVariants({ variant: "outline", size: "lg", className: "h-11 w-fit px-6 text-base" })}>
      Convert another letter
    </Link>
  );
}

/** R7.1. No close button, by design. */
function SafetyNotice({ text }: { text: string }) {
  return (
    <Alert role="note">
      <AlertDescription className="text-base text-foreground">{text}</AlertDescription>
    </Alert>
  );
}

/**
 * Text with key-fact highlights (R5.3). Each fact keeps its colour in both
 * columns; the underline style and a type label mean colour is never the only
 * signal. The label is screen-reader text after the fact and a tooltip.
 */
function FactText({ pieces, styles }: { pieces: HighlightPiece[]; styles: ReadonlyMap<string, FactStyle> }) {
  return (
    <>
      {pieces.map((piece) => {
        const className = pieceClassName(piece, styles);
        if (className === null) return <span key={piece.start}>{piece.text}</span>;
        const labels = piece.endingFactIds.flatMap((id) => styles.get(id)?.label ?? []);
        return (
          <span key={piece.start}>
            <span className={className} title={pieceTitle(piece, styles)}>
              {piece.text}
            </span>
            {labels.length > 0 && <span className="sr-only"> ({labels.join("; ")})</span>}
          </span>
        );
      })}
    </>
  );
}

function OriginalSentence({
  segment,
  selected,
  styles,
}: {
  segment: HighlightedSegment & { kind: "sentence" };
  selected: boolean;
  styles: ReadonlyMap<string, FactStyle>;
}) {
  const content = <FactText pieces={segment.pieces} styles={styles} />;
  if (!selected) return <span>{content}</span>;
  return <mark className="rounded-sm bg-primary/15 text-foreground ring-2 ring-primary/40">{content}</mark>;
}

function OriginalText({
  segments,
  styles,
  selectedSentenceId,
  register,
  containerRef,
}: {
  segments: HighlightedSegment[];
  styles: ReadonlyMap<string, FactStyle>;
  selectedSentenceId: string | null;
  register: (sentenceId: string, el: HTMLElement | null) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={containerRef}
      role="region"
      aria-labelledby="original-heading"
      tabIndex={0}
      className="max-h-[45vh] overflow-y-auto rounded-lg border bg-card p-4 text-lg leading-relaxed whitespace-pre-wrap focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:max-h-[calc(100vh-4rem)]"
    >
      {segments.map((segment) =>
        segment.kind === "text" ? (
          <span key={`t${segment.start}`}>
            <FactText pieces={segment.pieces} styles={styles} />
          </span>
        ) : (
          <span key={`s${segment.start}`} ref={(el) => register(segment.sentenceId, el)}>
            <OriginalSentence
              segment={segment}
              selected={segment.sentenceId === selectedSentenceId}
              styles={styles}
            />
          </span>
        ),
      )}
    </div>
  );
}

function Picture({ src }: { src: string | null }) {
  // Empty slot when there is no picture, so every line starts at the same place.
  if (src === null) return <div aria-hidden className="size-16 shrink-0" />;
  // The symbols route caches the PNG already, so skip the optimiser. The line text carries the meaning, so alt is empty.
  return (
    <Image
      src={src}
      alt=""
      width={PICTURE_SIZE}
      height={PICTURE_SIZE}
      unoptimized
      className="size-16 shrink-0 rounded-md bg-white object-contain"
    />
  );
}

function LineText({ pieces, styles }: { pieces: HighlightPiece[]; styles: ReadonlyMap<string, FactStyle> }) {
  return (
    <span>
      <FactText pieces={pieces} styles={styles} />
    </span>
  );
}

function LineRow({
  row,
  styles,
  selected,
  onSelect,
}: {
  row: LineRowData;
  styles: ReadonlyMap<string, FactStyle>;
  selected: boolean;
  onSelect: (row: LineRowData) => void;
}) {
  return (
    <li className="flex items-start gap-4">
      <Picture src={row.symbolSrc} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => onSelect(row)}
          className={cn(
            "min-h-16 w-full rounded-lg border px-4 py-3 text-left text-xl leading-snug transition-colors",
            "hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            selected ? "border-primary bg-primary/10" : "border-transparent",
          )}
        >
          <LineText pieces={row.pieces} styles={styles} />
          {row.flagged && (
            <Badge
              variant="destructive"
              className="ml-3 h-auto min-h-6 px-2 align-middle text-sm whitespace-normal"
            >
              {lineMarkerLabel(row.failedRules)}
            </Badge>
          )}
        </button>
        {/* Task 26: Edit and Undo edit go here. */}
      </div>
    </li>
  );
}

/** Task 27 replaces this with the full blocked state. */
function WithheldMessage() {
  return (
    <Alert variant="destructive">
      <AlertDescription className="text-base text-destructive">{WITHHELD_MESSAGE}</AlertDescription>
    </Alert>
  );
}

/** R4.4: the ARASAAC attribution, worded as in checker/data/LICENSE-pictograms.md. */
function SymbolAttribution() {
  return (
    <p className="text-base text-muted-foreground">
      {ARASAAC_ATTRIBUTION_PARTS.map((part) =>
        part.href ? (
          <a
            key={part.text}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
          >
            {part.text}
          </a>
        ) : (
          <span key={part.text}>{part.text}</span>
        ),
      )}
    </p>
  );
}

function ResultFooter() {
  return (
    <footer className="flex flex-col gap-4 border-t pt-6">
      <SymbolAttribution />
      <BackLink />
    </footer>
  );
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ResultView() {
  const { result } = useConversion();
  const layout = useMemo(() => (result ? resultLayout(result) : null), [result]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const originalRef = useRef<HTMLDivElement | null>(null);
  const sentenceEls = useRef(new Map<string, HTMLElement>());

  const register = useCallback((sentenceId: string, el: HTMLElement | null) => {
    if (el) sentenceEls.current.set(sentenceId, el);
    else sentenceEls.current.delete(sentenceId);
  }, []);

  /** Scrolls only the Original box, so the page and the selected line stay still. */
  const revealSentence = useCallback((sentenceId: string) => {
    const container = originalRef.current;
    const el = sentenceEls.current.get(sentenceId);
    if (!container || !el) return;
    const c = container.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    const top = scrollTopToReveal({ top: c.top, height: c.height, scrollTop: container.scrollTop }, e);
    container.scrollTo({ top, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, []);

  /** Selecting the selected line again clears the selection. */
  const onSelect = (row: LineRowData) => {
    const next = selectedLineId === row.id ? null : row.id;
    setSelectedLineId(next);
    if (next !== null && row.sourceSentenceId !== null) revealSentence(row.sourceSentenceId);
  };

  if (!result || !layout) {
    return (
      <div className="flex flex-col gap-4">
        <p>There is no Easy Read version to show. Letters aren&apos;t saved, so convert the letter again.</p>
        <BackLink />
      </div>
    );
  }

  const selectedRow = layout.rows.find((r) => r.id === selectedLineId) ?? null;
  const selectedSentenceId = selectedRow?.sourceSentenceId ?? null;

  return (
    <div className="flex flex-col gap-6">
      <SafetyNotice text={result.notice} />
      <div className="flex flex-wrap items-center gap-3">
        <RuleReport input={result} synonyms={result.actionSynonyms} />
        {/* Task 28: Export button, disabled when layout.withheld. */}
      </div>
      <div className="grid items-start gap-8 md:grid-cols-2">
        <section aria-labelledby="original-heading" className="flex flex-col gap-3 md:sticky md:top-4">
          <h2 id="original-heading" className="text-2xl font-semibold">
            Original
          </h2>
          <OriginalText
            segments={layout.segments}
            styles={layout.factStyles}
            selectedSentenceId={selectedSentenceId}
            register={register}
            containerRef={originalRef}
          />
        </section>
        <section aria-labelledby="easy-read-heading" className="flex flex-col gap-3">
          <h2 id="easy-read-heading" className="text-2xl font-semibold">
            Easy Read
          </h2>
          {layout.withheld ? (
            <WithheldMessage />
          ) : (
            <ul className="flex flex-col gap-3">
              {layout.rows.map((row) => (
                <LineRow
                  key={row.id}
                  row={row}
                  styles={layout.factStyles}
                  selected={row.id === selectedLineId}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
      <ResultFooter />
    </div>
  );
}
