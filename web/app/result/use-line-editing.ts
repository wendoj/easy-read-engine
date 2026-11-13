import { useState } from "react";
import type { AccessState } from "@/src/access/errors";
import type { ConversionResult } from "@/src/pipeline/types";
import { accessAfterError } from "@/src/ui/access-lock";
import { checkEdit } from "@/src/ui/api";
import {
  EDIT_PROBLEM_MESSAGES,
  EMPTY_HISTORY,
  type UndoHistory,
  applyCheckResponse,
  buildCheckRequest,
  editProblem,
  recordEdit,
  undoEdit,
} from "@/src/ui/line-edit";
import type { LineRow } from "@/src/ui/result-layout";
import type { EditState } from "./line-row";

/**
 * Inline line edits, checked by `/api/check`, and "Undo edit" from memory.
 * A failed check keeps the editor open with the draft, so the text isn't lost.
 */
export function useLineEditing({
  result,
  setResult,
  stopReading,
  setAccess,
  onReplaced,
}: {
  result: ConversionResult | null;
  setResult: (result: ConversionResult) => void;
  stopReading: () => void;
  setAccess: (access: AccessState) => void;
  /** Called when an edit or an undo replaces the result. */
  onReplaced: () => void;
}) {
  const [edit, setEdit] = useState<EditState | null>(null);
  const [history, setHistory] = useState<UndoHistory>(EMPTY_HISTORY);

  const onEdit = (row: LineRow) => {
    if (edit !== null) return;
    stopReading();
    setEdit({ lineId: row.id, draft: row.text, saving: false, error: null });
  };

  const onDraft = (draft: string) => setEdit((e) => (e === null ? e : { ...e, draft, error: null }));

  const onCancel = () => setEdit(null);

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
      // An access error also hides "Change this line" on the other lines.
      const next = accessAfterError(outcome.error);
      if (next !== null) setAccess(next);
      setEdit((e) => (e === null ? e : { ...e, saving: false, error: outcome.message }));
      return;
    }
    const after = applyCheckResponse(before, outcome.response);
    setHistory((h) => recordEdit(h, before, after));
    stopReading();
    setResult(after);
    setEdit(null);
    onReplaced();
  };

  /** The earlier result was checked already, so there is no server call. */
  const onUndo = () => {
    const undone = undoEdit(history, result);
    if (undone === null) return;
    setHistory(undone.history);
    stopReading();
    setResult(undone.result);
    onReplaced();
  };

  return { edit, history, onEdit, onDraft, onCancel, onSave, onUndo };
}
