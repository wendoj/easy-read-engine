"use client";
import { ArrowDown, ChevronDown, Flag, Pencil } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useId, useState } from "react";
import { ProblemIcon } from "@/components/status-icons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { FactStyle, HighlightPiece } from "@/src/ui/key-fact-highlight";
import { statusFade } from "@/src/ui/motion";
import type { ReadAloud } from "@/src/ui/read-aloud";
import type { LineRow as LineRowData } from "@/src/ui/result-layout";
import { cn } from "cn";
import { FactText, ListenButton } from "./fact-text";

const PICTURE_SIZE = 80;

/** For "go to line" from the Check report. */
export const lineElementId = (lineId: string) => `line-${lineId}`;

export interface EditState {
  lineId: string;
  draft: string;
  saving: boolean;
  error: string | null;
}

function Picture({ src }: { src: string | null }) {
  // An empty slot keeps every line starting at the same place.
  if (src === null) return <div aria-hidden className="size-20 shrink-0 rounded-lg bg-wash" />;
  // The symbols route caches the PNG, so skip the optimiser. Alt is empty because
  // the line next to it says the same thing.
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

/** The picture, with the line number under it: the check report and the to-do list name lines by number. */
function PictureColumn({ src, number, children }: { src: string | null; number: number; children?: React.ReactNode }) {
  return (
    <div className="flex w-20 shrink-0 flex-col items-center gap-1">
      <Picture src={src} />
      {children ?? <span className="text-lg text-muted-foreground tabular-nums">Line {number}</span>}
    </div>
  );
}

/**
 * Selects the line: its tools appear and its sentence lights up in the
 * Original. One tab stop per line, so the list stays quick to move through.
 */
function LineButton({ number, selected, onClick }: { number: number; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`Line ${number}: show what you can do with it`}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-12 w-full items-center justify-center rounded-full border text-lg font-semibold tabular-nums whitespace-nowrap [-webkit-tap-highlight-color:transparent]",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-card text-foreground [@media(hover:hover)]:hover:bg-wash",
      )}
    >
      Line {number}
    </button>
  );
}

/**
 * A failed check on this line. The reader gets one plain instruction; the
 * checker's reasons, written for the supporter, are behind "Why?". No red:
 * the line passed P1 and is shown, it just needs a second look.
 */
function CheckFlag({ reasons }: { reasons: string[] }) {
  const [open, setOpen] = useState(false);
  const reasonsId = useId();
  return (
    <div className="flex w-full flex-col gap-2 rounded-xl border border-transparent bg-tint px-4 py-3 text-lg">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="flex items-center gap-2 font-semibold">
          <Flag aria-hidden strokeWidth={2} absoluteStrokeWidth className="size-5 shrink-0" />
          Check this line with the letter.
        </p>
        {reasons.length > 0 && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={reasonsId}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex min-h-12 items-center gap-1 font-semibold text-link underline underline-offset-4 hover:decoration-2"
          >
            Why?
            <ChevronDown aria-hidden strokeWidth={2} absoluteStrokeWidth className={cn("size-5", open && "rotate-180")} />
          </button>
        )}
      </div>
      <ul id={reasonsId} hidden={!open} className="flex flex-col gap-1 [overflow-wrap:anywhere]">
        {reasons.map((reason, i) => (
          <li key={i}>{reason}</li>
        ))}
      </ul>
    </div>
  );
}

function LineText({ pieces, styles }: { pieces: HighlightPiece[]; styles: ReadonlyMap<string, FactStyle> }) {
  return (
    <span>
      <FactText pieces={pieces} styles={styles} explain />
    </span>
  );
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
        <Button type="button" variant="outline" disabled={edit.saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function LineRow({
  row,
  index,
  readAloud,
  styles,
  selected,
  onSelect,
  edit,
  canEdit,
  editDisabled,
  onEdit,
  onDraft,
  onSave,
  onCancel,
  nextToCheck,
  onGoToLine,
}: {
  row: LineRowData;
  index: number;
  readAloud: ReadAloud;
  styles: ReadonlyMap<string, FactStyle>;
  selected: boolean;
  onSelect: (row: LineRowData) => void;
  /** Set when this line's editor is open. */
  edit: EditState | null;
  /** False without judge access: checking an edit calls a model. */
  canEdit: boolean;
  /** Only 1 draft is open at a time. */
  editDisabled: boolean;
  onEdit: (row: LineRowData) => void;
  onDraft: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
  /** The next flagged line after this one, with its number, or null. */
  nextToCheck: { id: string; number: number } | null;
  onGoToLine: (lineId: string) => void;
}) {
  const number = index + 1;
  if (edit !== null) {
    return (
      <li
        id={lineElementId(row.id)}
        tabIndex={-1}
        className="flex scroll-mt-6 items-start gap-4 bg-wash p-4 sm:gap-6 sm:p-6"
      >
        <PictureColumn src={row.symbolSrc} number={number} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <LineEditor edit={edit} onDraft={onDraft} onSave={onSave} onCancel={onCancel} />
        </div>
      </li>
    );
  }
  return (
    <li
      id={lineElementId(row.id)}
      tabIndex={-1}
      className={cn("flex scroll-mt-6 items-start gap-4 p-4 sm:gap-6 sm:p-6", selected && "bg-accent-tint")}
    >
      <PictureColumn src={row.symbolSrc} number={number}>
        <LineButton number={number} selected={selected} onClick={() => onSelect(row)} />
      </PictureColumn>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-3">
        {/*
          Words in the line are buttons (tap a word), so the line can't be a
          button too. A click on the text still selects it; the "Line N"
          button does the same for keyboard and screen reader users.
        */}
        <div
          onClick={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest("button, [role=dialog]") === null) onSelect(row);
          }}
          className={cn(
            "min-h-20 w-full cursor-pointer px-1 py-2 text-left text-2xl leading-normal text-pretty [overflow-wrap:anywhere]",
            row.important && "font-semibold",
          )}
        >
          <LineText pieces={row.pieces} styles={styles} />
        </div>
        {row.flagged && <CheckFlag reasons={row.reasons} />}
        {selected && (
          <>
            {/* Stacked columns put the Original screens away, so the source sentence shows here instead. */}
            {row.sourceText !== null && (
              <div className="flex w-full flex-col gap-1 rounded-xl border border-transparent bg-card px-4 py-3 text-lg [overflow-wrap:anywhere] lg:hidden">
                <p className="font-semibold">From the letter</p>
                <p className="leading-normal">{row.sourceText}</p>
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              <ListenButton id={row.id} text={row.text} label={`line ${number}`} readAloud={readAloud} />
              {canEdit && (
                <Button type="button" variant="outline" disabled={editDisabled} onClick={() => onEdit(row)}>
                  <Pencil aria-hidden strokeWidth={2} absoluteStrokeWidth data-icon="inline-start" />
                  Change this line
                </Button>
              )}
              {nextToCheck !== null && (
                <Button
                  type="button"
                  variant="outline"
                  aria-label={`Next line to check, line ${nextToCheck.number}`}
                  onClick={() => onGoToLine(nextToCheck.id)}
                >
                  <ArrowDown aria-hidden strokeWidth={2} absoluteStrokeWidth data-icon="inline-start" />
                  Next line to check
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </li>
  );
}
