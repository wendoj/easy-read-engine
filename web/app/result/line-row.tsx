"use client";
import { Pencil, ScanSearch } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";
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
}) {
  if (edit !== null) {
    return (
      <li
        id={lineElementId(row.id)}
        tabIndex={-1}
        className="flex scroll-mt-6 items-start gap-4 bg-wash p-4 sm:gap-6 sm:p-6"
      >
        <Picture src={row.symbolSrc} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <LineEditor edit={edit} onDraft={onDraft} onSave={onSave} onCancel={onCancel} />
        </div>
      </li>
    );
  }
  return (
    <li id={lineElementId(row.id)} tabIndex={-1} className="flex scroll-mt-6 items-start gap-4 p-4 sm:gap-6 sm:p-6">
      <Picture src={row.symbolSrc} />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-3">
        {/*
          Words in the line are buttons (tap a word), so the line can't be a
          button too. A click still selects it; "Show in the Original" does the
          same for keyboard and screen reader users.
        */}
        <div
          onClick={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest("button, [role=dialog]") === null) onSelect(row);
          }}
          className={cn(
            "min-h-20 w-full rounded-xl border-2 px-3 py-3 text-left text-2xl leading-normal",
            selected ? "border-primary bg-accent-tint" : "border-transparent",
          )}
        >
          <LineText pieces={row.pieces} styles={styles} />
        </div>
        <div className="flex flex-wrap gap-3">
          <ListenButton id={row.id} text={row.text} label={`line ${index + 1}`} readAloud={readAloud} />
          <Button type="button" variant="outline" aria-pressed={selected} onClick={() => onSelect(row)}>
            <ScanSearch aria-hidden strokeWidth={2} absoluteStrokeWidth data-icon="inline-start" />
            Show in the Original
          </Button>
          {canEdit && (
            <Button type="button" variant="outline" disabled={editDisabled} onClick={() => onEdit(row)}>
              <Pencil aria-hidden strokeWidth={2} absoluteStrokeWidth data-icon="inline-start" />
              Change this line
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}
