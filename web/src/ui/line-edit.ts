/** Edit history lives in memory only, so "Undo edit" restores a result that was already checked. */
import { z } from "zod";
import {
  type Line,
  checkResultSchema,
  keyFactSchema,
  lineFactSpanSchema,
  sentenceSchema,
} from "@/src/checker-client/schemas";
import { MAX_EDIT_LINE_CHARS } from "@/src/check/errors";
import type { ConversionResult } from "@/src/pipeline/types";
import { lineSchema } from "./convert-events";

export const MAX_UNDO = 20;

export interface CheckRequestBody {
  original: string;
  lines: Line[];
  editedLineIds: string[];
  previousChecks: ConversionResult["checks"];
}

/** `CheckResponse` in src/check/handler.ts. */
export const checkResponseSchema = z.object({
  status: z.enum(["passed", "flagged", "blocked"]),
  checks: z.array(checkResultSchema),
  lines: z.array(lineSchema),
  lineFacts: z.array(lineFactSpanSchema),
  sentences: z.array(sentenceSchema),
  keyFacts: z.array(keyFactSchema),
  judgeAvailable: z.boolean(),
  models: z.array(
    z.object({
      task: z.enum(["rewrite", "regenerate", "judge"]),
      attempt: z.number(),
      provider: z.string(),
      model: z.string(),
    }),
  ),
});

export type CheckResponseBody = z.infer<typeof checkResponseSchema>;

export type EditProblem = "empty" | "too_long" | "unchanged" | "no_line";

export function editProblem(lines: readonly Line[], lineId: string, text: string): EditProblem | null {
  const line = lines.find((l) => l.id === lineId);
  if (!line) return "no_line";
  if (text.trim() === "") return "empty";
  if (text.length > MAX_EDIT_LINE_CHARS) return "too_long";
  if (text === line.text) return "unchanged";
  return null;
}

export const EDIT_PROBLEM_MESSAGES: Record<Exclude<EditProblem, "unchanged" | "no_line">, string> = {
  empty: "A line can't be empty. Write some text or select Cancel.",
  too_long: `A line can have up to ${MAX_EDIT_LINE_CHARS} characters. Make the line shorter.`,
};

/** Only the text of 1 line changes. Order, IDs, sources and pictures stay the same. */
export function editLine(lines: readonly Line[], lineId: string, text: string): Line[] {
  return lines.map((l) => (l.id === lineId ? { ...l, text } : { ...l }));
}

/** The server carries over P9 and P10 verdicts from `previousChecks` for lines that weren't edited. */
export function buildCheckRequest(result: ConversionResult, lineId: string, text: string): CheckRequestBody {
  return {
    original: result.original.text,
    lines: editLine(result.lines, lineId, text),
    editedLineIds: [lineId],
    previousChecks: result.checks,
  };
}

/** The Original text is kept as it was. */
export function applyCheckResponse(previous: ConversionResult, response: CheckResponseBody): ConversionResult {
  return {
    ...previous,
    status: response.status,
    original: { text: previous.original.text, sentences: response.sentences },
    keyFacts: response.keyFacts,
    lines: response.status === "blocked" ? [] : response.lines,
    checks: response.checks,
    lineFacts: response.status === "blocked" ? [] : response.lineFacts,
    judgeAvailable: response.judgeAvailable,
    models: [...previous.models, ...response.models],
  };
}

/**
 * Earlier results, newest last. If the shown result is replaced some other way
 * (a new conversion), `current` no longer matches it and the history doesn't apply.
 */
export interface UndoHistory {
  past: ConversionResult[];
  current: ConversionResult | null;
}

export const EMPTY_HISTORY: UndoHistory = { past: [], current: null };

export function recordEdit(history: UndoHistory, before: ConversionResult, after: ConversionResult): UndoHistory {
  const base = history.current === before ? history.past : [];
  return { past: [...base, before].slice(-MAX_UNDO), current: after };
}

export function canUndo(history: UndoHistory, shown: ConversionResult | null): boolean {
  return shown !== null && history.current === shown && history.past.length > 0;
}

export function undoEdit(
  history: UndoHistory,
  shown: ConversionResult | null,
): { result: ConversionResult; history: UndoHistory } | null {
  if (!canUndo(history, shown)) return null;
  const result = history.past[history.past.length - 1];
  return { result, history: { past: history.past.slice(0, -1), current: result } };
}
