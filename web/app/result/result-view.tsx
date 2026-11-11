"use client";
/**
 * Side-by-side result screen (task 22, R5.1, R5.2, R7.1).
 *
 * The Original is on the left and the Easy Read lines are on the right, with a
 * picture to the left of each line. Selecting a line highlights the sentence
 * it came from. The safety notice is always at the top and can't be closed.
 *
 * The result comes from `useConversion()`. It is never stored (R7.4: no
 * localStorage, sessionStorage, IndexedDB, cookies or server cache hold
 * letter text), so a reload loses it. What a reload shows instead
 * (`src/ui/result-url.ts`):
 * - A sample letter has its ID in the URL (`/result?sample=<id>`). Sample
 *   text is public, so the screen loads the sample again from `/api/sample`.
 * - The user's own letter: a plain "Your Easy Read version is gone" message
 *   and "Start again". While a user-letter result is on screen, the browser
 *   asks before a reload or closing the tab (`beforeunload`).
 *
 * Layout: Original left, Easy Read right on wide screens, with the Easy Read
 * column wider as the main reading column. On narrow screens they stack,
 * Original first (it is always shown, safety.md), with a skip link to the
 * Easy Read version.
 *
 * Seams for later tasks:
 * - Pictures load from `/symbols/<id>` (task 23); `ResultFooter` shows the ARASAAC attribution (R4.4).
 * - Task 24: `RuleReport` shows the pass count and opens the report; flagged lines name their failed rules.
 * - Task 25: `FactText` highlights key facts in both columns, one colour per fact (R5.3).
 *   Failed key facts in the Original get a red ring, also when blocked; task 27 builds on this.
 * - Task 26: each line has an Edit button that opens an inline `Textarea`. Save sends every line
 *   to `/api/check` and puts the checked result in context; "Undo edit" in the toolbar restores
 *   the result before the last edit from memory (`src/ui/line-edit.ts`). A failed check keeps
 *   the editor open with the draft, so the text isn't lost.
 * - Task 27: `BlockedState` shows no lines, the failed key facts with their values from the
 *   Original, and "Undo edit" (block from an edit) or "Start again" (block from the conversion).
 *   Logic is in `src/ui/blocked-state.ts`.
 * - Task 28: "Download PDF" in the toolbar, enabled only when `canExport(result)` (R9.5; also off, with a
 *   fixed Alert, when the judge gave no answer so P10 never ran). It posts the
 *   result to `/api/export`, which checks P1 again, and saves the PDF from a Blob. Errors (409, 429,
 *   503) show in an Alert. "Print" opens `/print` with the same layout.
 * - Task 29: a result from a sample letter shows "Recorded on <date> with <model>" and says
 *   that P1 to P8 ran again and P9 and P10 are from the recording.
 */
import { Info, LoaderCircle, Pencil } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlagIcon, ProblemIcon } from "@/components/status-icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RECORDED_CHECKS_NOTE, type SampleInfo, recordedLabel } from "@/src/samples/sample";
import { EXPORT_FILENAME } from "@/src/export/errors";
import { checkEdit, exportPdf, loadSample } from "@/src/ui/api";
import {
  BLOCKED_HEADING,
  BLOCKED_MESSAGES,
  type BlockSource,
  FAILED_FACTS_HEADING,
  type FailedFact,
  NO_FAILED_FACTS_MESSAGE,
  NOT_JUDGED_EXPORT_MESSAGE,
  blockSource,
  canExport,
  failedKeyFacts,
} from "@/src/ui/blocked-state";
import { ARASAAC_ATTRIBUTION_PARTS } from "@/src/symbols/attribution";
import { useConversion } from "@/src/ui/conversion-context";
import { lineMarkerLabel } from "@/src/ui/rule-report";
import {
  type FactStyle,
  type HighlightPiece,
  type HighlightedSegment,
  factClassName,
  pieceClassName,
  pieceTitle,
} from "@/src/ui/key-fact-highlight";
import {
  EDIT_PROBLEM_MESSAGES,
  EMPTY_HISTORY,
  type UndoHistory,
  applyCheckResponse,
  buildCheckRequest,
  canUndo,
  editProblem,
  recordEdit,
  undoEdit,
} from "@/src/ui/line-edit";
import { statusFade } from "@/src/ui/motion";
import { GONE_HEADING, GONE_MESSAGE, SAMPLE_LOADING_MESSAGE, parseSampleId } from "@/src/ui/result-url";
import { type LineRow as LineRowData, resultLayout, scrollTopToReveal } from "@/src/ui/result-layout";
import { cn } from "cn";
import { RuleReport } from "./rule-report";

const PICTURE_SIZE = 80;

const SECTION_HEADING = "text-[28px] leading-tight font-semibold";

function StartAgainLink() {
  return (
    <Link href="/" className={buttonVariants({ className: "w-fit" })}>
      Start again
    </Link>
  );
}

/** R7.1. No close button, by design. */
function SafetyNotice({ text }: { text: string }) {
  return (
    <Alert role="note" className="border-2 border-primary bg-accent-tint">
      <Info aria-hidden strokeWidth={2} absoluteStrokeWidth />
      <AlertDescription className="text-lg font-semibold text-foreground">{text}</AlertDescription>
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
  return <mark className="rounded-sm bg-accent-tint text-foreground ring-2 ring-primary">{content}</mark>;
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
      className="max-h-[50vh] overflow-y-auto overscroll-contain p-5 text-lg leading-normal whitespace-pre-wrap focus-visible:outline-offset-[-3px] lg:max-h-[calc(100vh-8rem)]"
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
  if (src === null) return <div aria-hidden className="size-20 shrink-0 rounded-lg bg-wash" />;
  // The symbols route caches the PNG already, so skip the optimiser. Alt is empty because the
  // picture shows the line next to it: a screen reader would read the same thing twice.
  return (
    <Image
      src={src}
      alt=""
      width={PICTURE_SIZE}
      height={PICTURE_SIZE}
      unoptimized
      className="size-20 shrink-0 rounded-lg border border-border bg-white object-contain"
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

/** The open editor: the line being edited, its draft, and the state of its check. */
interface EditState {
  lineId: string;
  draft: string;
  saving: boolean;
  error: string | null;
}

function LineEditor({
  edit,
  onDraft,
  onSave,
  onCancel,
}: {
  edit: EditState;
  onDraft: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const reduce = useReducedMotion() ?? false;
  const errorId = `edit-error-${edit.lineId}`;
  const fieldId = `edit-field-${edit.lineId}`;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <label htmlFor={fieldId} className="text-lg font-semibold">
        Change the words in this line
      </label>
      <Textarea
        id={fieldId}
        autoFocus
        value={edit.draft}
        disabled={edit.saving}
        aria-invalid={edit.error !== null}
        aria-describedby={edit.error !== null ? errorId : undefined}
        onChange={(e) => onDraft(e.target.value)}
        className="min-h-24 text-2xl leading-normal"
      />
      {edit.error !== null && (
        <motion.div {...statusFade(reduce)}>
          <Alert variant="destructive" id={errorId}>
            <ProblemIcon />
            <AlertDescription className="text-lg text-destructive">{edit.error}</AlertDescription>
          </Alert>
        </motion.div>
      )}
      <div className="flex gap-3">
        <Button type="submit" disabled={edit.saving}>
          {edit.saving ? "Checking…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={edit.saving}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function LineRow({
  row,
  styles,
  selected,
  onSelect,
  edit,
  editDisabled,
  onEdit,
  onDraft,
  onSave,
  onCancel,
}: {
  row: LineRowData;
  styles: ReadonlyMap<string, FactStyle>;
  selected: boolean;
  onSelect: (row: LineRowData) => void;
  /** Set when this line's editor is open. */
  edit: EditState | null;
  /** True while any line is being edited, so only 1 draft is open at a time. */
  editDisabled: boolean;
  onEdit: (row: LineRowData) => void;
  onDraft: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  if (edit !== null) {
    return (
      <li className="flex items-start gap-4 bg-wash p-4 sm:gap-6 sm:p-6">
        <Picture src={row.symbolSrc} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <LineEditor edit={edit} onDraft={onDraft} onSave={onSave} onCancel={onCancel} />
        </div>
      </li>
    );
  }
  return (
    <li className="flex items-start gap-4 p-4 sm:gap-6 sm:p-6">
      <Picture src={row.symbolSrc} />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-3">
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => onSelect(row)}
          className={cn(
            "min-h-20 w-full rounded-xl border-2 px-3 py-3 text-left text-2xl leading-normal",
            "[-webkit-tap-highlight-color:transparent] hover:bg-tint",
            selected ? "border-primary bg-accent-tint hover:bg-accent-tint" : "border-transparent",
          )}
        >
          <LineText pieces={row.pieces} styles={styles} />
          {/* The failed rule in words with an icon, never colour alone. Shown at once, never animated. */}
          {row.flagged && (
            <span className="mt-2 block">
              <Badge
                variant="destructive"
                className="h-auto min-h-9 border-destructive bg-red-50 px-3 py-1 text-lg font-semibold whitespace-normal text-destructive [&>svg]:size-5!"
              >
                <FlagIcon />
                {lineMarkerLabel(row.failedRules)}
              </Badge>
            </span>
          )}
        </button>
        <Button type="button" variant="outline" disabled={editDisabled} onClick={() => onEdit(row)}>
          <Pencil aria-hidden strokeWidth={2} absoluteStrokeWidth data-icon="inline-start" />
          Change this line
        </Button>
      </div>
    </li>
  );
}

/**
 * Task 27 (R2.5, R9.3, R9.5): no lines, the key facts that failed with their
 * values from the Original, and one way forward. The Alert has role="alert",
 * so the message is read out once when it appears.
 */
function BlockedState({
  source,
  failedFacts,
  styles,
  onUndo,
}: {
  source: BlockSource;
  failedFacts: FailedFact[];
  styles: ReadonlyMap<string, FactStyle>;
  onUndo: () => void;
}) {
  const undoRef = useRef<HTMLButtonElement>(null);
  // After a blocked edit the editor is gone, so put focus on the way back.
  useEffect(() => {
    if (source === "edit") undoRef.current?.focus();
  }, [source]);
  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <Alert variant="destructive" role="alert" className="border-2 border-destructive">
        <ProblemIcon strong className="translate-y-1!" />
        <AlertTitle className="text-xl font-semibold">{BLOCKED_HEADING}</AlertTitle>
        <AlertDescription className="text-lg text-destructive">{BLOCKED_MESSAGES[source]}</AlertDescription>
      </Alert>
      <section aria-labelledby="failed-facts-heading" className="flex flex-col gap-3">
        <h3 id="failed-facts-heading" className="text-[22px] leading-tight font-semibold">
          {FAILED_FACTS_HEADING}
        </h3>
        {failedFacts.length === 0 ? (
          <p className="text-lg">{NO_FAILED_FACTS_MESSAGE}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {failedFacts.map((fact) => {
              const style = styles.get(fact.id);
              return (
                <li key={fact.id} className="text-lg leading-relaxed">
                  <span className="font-semibold">{capitalise(fact.typeLabel)}: </span>
                  <span className={style ? factClassName(style) : undefined}>{fact.value}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {source === "edit" ? (
        <Button ref={undoRef} type="button" className="w-fit" onClick={onUndo}>
          Undo edit
        </Button>
      ) : (
        // The input screen is kept on navigation, so the confirmed text is still there.
        <Link href="/" className={buttonVariants({ className: "w-fit" })}>
          Start again
        </Link>
      )}
    </div>
  );
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** R4.4: the ARASAAC attribution, worded as in checker/data/LICENSE-pictograms.md. */
function SymbolAttribution() {
  return (
    <p className="text-lg text-muted-foreground">
      {ARASAAC_ATTRIBUTION_PARTS.map((part) =>
        part.href ? (
          <a
            key={part.text}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-link underline underline-offset-4 hover:decoration-2"
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
    <footer className="border-t border-border pt-6">
      <SymbolAttribution />
    </footer>
  );
}

/** Saves a Blob as a file. The object URL is revoked once the download has started. */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Task 29: when and with which model a sample letter was recorded, and which checks ran again. */
function SampleLabel({ sample }: { sample: SampleInfo }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-semibold">{recordedLabel(sample)}</p>
      <p className="text-lg text-muted-foreground">{RECORDED_CHECKS_NOTE}</p>
    </div>
  );
}

/**
 * No result in memory: after a reload, in a new tab, or before any
 * conversion. A sample's ID in the URL loads it again; a user's letter is
 * gone, because letters are never stored (R7.4).
 */
function NoResult({ sampleId, error }: { sampleId: string | null; error: string | null }) {
  if (sampleId !== null && error === null) {
    return (
      <p role="status" className="flex items-center gap-3 text-xl font-semibold">
        <LoaderCircle aria-hidden className="size-6 motion-safe:animate-spin" />
        {SAMPLE_LOADING_MESSAGE}
      </p>
    );
  }
  if (error !== null) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="destructive" role="alert">
          <ProblemIcon />
          <AlertDescription className="text-lg text-destructive">{error}</AlertDescription>
        </Alert>
        <StartAgainLink />
      </div>
    );
  }
  return (
    <section
      aria-labelledby="gone-heading"
      className="flex max-w-[720px] flex-col gap-4 rounded-2xl border border-border bg-card p-6"
    >
      <h2 id="gone-heading" className={SECTION_HEADING}>
        {GONE_HEADING}
      </h2>
      <p className="text-xl leading-normal">{GONE_MESSAGE}</p>
      <StartAgainLink />
    </section>
  );
}

export function ResultView() {
  const sampleId = parseSampleId(useSearchParams().get("sample"));
  const { result, sample, setResult, startResult } = useConversion();
  const reduceMotion = useReducedMotion() ?? false;
  const [edit, setEdit] = useState<EditState | null>(null);
  const [history, setHistory] = useState<UndoHistory>(EMPTY_HISTORY);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const layout = useMemo(() => (result ? resultLayout(result) : null), [result]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const originalRef = useRef<HTMLDivElement | null>(null);
  const sentenceEls = useRef(new Map<string, HTMLElement>());

  // After a reload of a sample result, load the public sample again. It makes no model call.
  const reloadSampleId = result === null ? sampleId : null;
  useEffect(() => {
    if (reloadSampleId === null) return;
    const controller = new AbortController();
    void loadSample(reloadSampleId, { signal: controller.signal }).then((outcome) => {
      if (outcome.ok) startResult(outcome.result, outcome.sample);
      else if (!outcome.aborted) setReloadError(outcome.message);
    });
    return () => controller.abort();
  }, [reloadSampleId, startResult]);

  // The user's own letter can't come back after a reload, so the browser asks first.
  const userLetterShown = result !== null && sample === null;
  useEffect(() => {
    if (!userLetterShown) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [userLetterShown]);

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

  const onEdit = (row: LineRowData) => {
    if (edit !== null) return;
    setEdit({ lineId: row.id, draft: row.text, saving: false, error: null });
  };

  const onDraft = (draft: string) => setEdit((e) => (e === null ? e : { ...e, draft, error: null }));

  const onCancel = () => setEdit(null);

  /** Checks the edit with `/api/check`. On any failure the editor stays open with the draft. */
  const onSave = async () => {
    if (edit === null || edit.saving || result === null) return;
    const before = result;
    const { lineId, draft } = edit;
    const problem = editProblem(before.lines, lineId, draft);
    if (problem === "unchanged" || problem === "no_line") {
      setEdit(null);
      return;
    }
    if (problem !== null) {
      setEdit({ ...edit, error: EDIT_PROBLEM_MESSAGES[problem] });
      return;
    }
    setEdit({ ...edit, saving: true, error: null });
    const outcome = await checkEdit(buildCheckRequest(before, lineId, draft));
    if (!outcome.ok) {
      setEdit((e) => (e === null ? e : { ...e, saving: false, error: outcome.message }));
      return;
    }
    const after = applyCheckResponse(before, outcome.response);
    setHistory((h) => recordEdit(h, before, after));
    setResult(after);
    setEdit(null);
    setExportError(null);
  };

  const undoAllowed = edit === null && canUndo(history, result);
  const blocked = blockSource(result, history);
  const failedFacts = useMemo(() => (result ? failedKeyFacts(result) : []), [result]);

  const exportAllowed = canExport(result);

  /** Posts the result to `/api/export` and saves the PDF. The server checks P1 again (R9.5). */
  const onExport = async () => {
    if (result === null || !canExport(result) || exporting) return;
    setExporting(true);
    setExportError(null);
    const outcome = await exportPdf(result);
    setExporting(false);
    if (outcome.ok) saveBlob(outcome.pdf, EXPORT_FILENAME);
    else if (!outcome.aborted) setExportError(outcome.message);
  };

  /** Restores the result before the last edit exactly. It was checked already, so no server call. */
  const onUndo = () => {
    const undone = undoEdit(history, result);
    if (undone === null) return;
    setHistory(undone.history);
    setResult(undone.result);
    setExportError(null);
  };

  if (!result || !layout) return <NoResult sampleId={sampleId} error={reloadError} />;

  const selectedRow = layout.rows.find((r) => r.id === selectedLineId) ?? null;
  const selectedSentenceId = selectedRow?.sourceSentenceId ?? null;

  // Nothing enters or moves on load. Only a status that appears later (an
  // export error, the blocked state after an edit) fades in, and not under
  // reduced motion.
  return (
    <div className="flex flex-col gap-6">
      <SafetyNotice text={result.notice} />
      {sample !== null && <SampleLabel sample={sample} />}
      <div className="flex flex-wrap items-center gap-3">
        <RuleReport input={result} synonyms={result.actionSynonyms} />
        {/* When blocked, "Undo edit" is in the blocked state instead. */}
        {undoAllowed && blocked === null && (
          <Button type="button" variant="outline" onClick={onUndo}>
            Undo edit
          </Button>
        )}
        {/* R9.5: disabled while blocked, and while a line is being edited. */}
        <Button
          type="button"
          disabled={!exportAllowed || exporting || edit !== null}
          onClick={() => void onExport()}
        >
          {exporting && <LoaderCircle aria-hidden data-icon="inline-start" className="motion-safe:animate-spin" />}
          {exporting ? "Making the PDF…" : "Download PDF"}
        </Button>
        {exportAllowed && edit === null && (
          <Link href="/print" className={buttonVariants({ variant: "outline" })}>
            Print
          </Link>
        )}
      </div>
      {/* Safety: no export while P10 (no advice) hasn't run. Not dismissable. */}
      {blocked === null && !result.judgeAvailable && (
        <Alert role="status" className="border-input">
          <FlagIcon />
          <AlertDescription className="text-lg text-foreground">{NOT_JUDGED_EXPORT_MESSAGE}</AlertDescription>
        </Alert>
      )}
      {exportError !== null && (
        <motion.div {...statusFade(reduceMotion)}>
          <Alert variant="destructive" role="alert">
            <ProblemIcon />
            <AlertDescription className="text-lg text-destructive">{exportError}</AlertDescription>
          </Alert>
        </motion.div>
      )}
      {/* Narrow screens stack the columns, Original first, so this skips to the Easy Read version. */}
      <a href="#easy-read-heading" className={buttonVariants({ variant: "outline", className: "w-fit lg:hidden" })}>
        Go to the Easy Read version
      </a>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section aria-labelledby="original-heading" className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-6">
          <h2 id="original-heading" className={SECTION_HEADING}>
            Original
          </h2>
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <OriginalText
              segments={layout.segments}
              styles={layout.factStyles}
              selectedSentenceId={selectedSentenceId}
              register={register}
              containerRef={originalRef}
            />
          </div>
        </section>
        <section aria-labelledby="easy-read-heading" className="flex min-w-0 flex-col gap-3">
          <h2 id="easy-read-heading" tabIndex={-1} className={cn(SECTION_HEADING, "scroll-mt-6")}>
            Easy Read
          </h2>
          {/*
            A conversion that was blocked from the start shows at once (the
            reader must see why); one blocked by an edit fades in. The lines
            never animate.
          */}
          {layout.withheld ? (
            <motion.div key="blocked" {...statusFade(reduceMotion || blocked !== "edit")}>
              <BlockedState
                source={blocked ?? "conversion"}
                failedFacts={failedFacts}
                styles={layout.factStyles}
                onUndo={onUndo}
              />
            </motion.div>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {layout.rows.map((row) => (
                <LineRow
                  key={row.id}
                  row={row}
                  styles={layout.factStyles}
                  selected={row.id === selectedLineId}
                  onSelect={onSelect}
                  edit={edit?.lineId === row.id ? edit : null}
                  editDisabled={edit !== null}
                  onEdit={onEdit}
                  onDraft={onDraft}
                  onSave={() => void onSave()}
                  onCancel={onCancel}
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
