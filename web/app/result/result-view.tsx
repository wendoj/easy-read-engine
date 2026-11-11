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
 * - Task 23: pictures load from `/symbols/<id>`; the ARASAAC attribution goes in `ResultFooter`.
 * - Task 24: the pass count and report panel replace `StatusBadge`; flagged rows get rule details.
 * - Task 25: key-fact highlighting goes in `OriginalSentence` and `LineText`.
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
import type { Status } from "@/src/pipeline/types";
import { useConversion } from "@/src/ui/conversion-context";
import {
  type LineRow as LineRowData,
  type OriginalSegment,
  resultLayout,
  scrollTopToReveal,
} from "@/src/ui/result-layout";
import { cn } from "cn";

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

/** Task 24 replaces this with the pass count that opens the report. */
function StatusBadge({ status }: { status: Status }) {
  const label = { passed: "All checks passed", flagged: "Some checks failed", blocked: "Withheld" }[status];
  return (
    <Badge variant={status === "passed" ? "secondary" : "destructive"} className="h-7 px-3 text-sm">
      {label}
    </Badge>
  );
}

/** Task 25 adds key-fact highlights inside the sentence. */
function OriginalSentence({ segment, selected }: { segment: OriginalSegment & { kind: "sentence" }; selected: boolean }) {
  if (!selected) return <span>{segment.text}</span>;
  return <mark className="rounded-sm bg-primary/15 text-foreground ring-2 ring-primary/40">{segment.text}</mark>;
}

function OriginalText({
  segments,
  selectedSentenceId,
  register,
  containerRef,
}: {
  segments: OriginalSegment[];
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
          <span key={`t${segment.start}`}>{segment.text}</span>
        ) : (
          <span key={`s${segment.start}`} ref={(el) => register(segment.sentenceId, el)}>
            <OriginalSentence segment={segment} selected={segment.sentenceId === selectedSentenceId} />
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

/** Task 25 adds key-fact highlights. */
function LineText({ text }: { text: string }) {
  return <span>{text}</span>;
}

function LineRow({
  row,
  selected,
  onSelect,
}: {
  row: LineRowData;
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
          <LineText text={row.text} />
          {row.flagged && (
            <Badge variant="destructive" className="ml-3 h-6 px-2 align-middle text-sm">
              Failed a check
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

/** Task 23 adds the ARASAAC attribution here. */
function ResultFooter() {
  return (
    <footer className="flex flex-col gap-4 border-t pt-6">
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
        <StatusBadge status={layout.status} />
        {/* Task 28: Export button, disabled when layout.withheld. */}
      </div>
      <div className="grid items-start gap-8 md:grid-cols-2">
        <section aria-labelledby="original-heading" className="flex flex-col gap-3 md:sticky md:top-4">
          <h2 id="original-heading" className="text-2xl font-semibold">
            Original
          </h2>
          <OriginalText
            segments={layout.segments}
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
                <LineRow key={row.id} row={row} selected={row.id === selectedLineId} onSelect={onSelect} />
              ))}
            </ul>
          )}
        </section>
      </div>
      <ResultFooter />
    </div>
  );
}
