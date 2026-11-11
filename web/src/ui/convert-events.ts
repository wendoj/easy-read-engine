/**
 * Validates the events in the `/api/convert` stream and turns progress events
 * into a label and a percentage for the input screen. Browser-safe: imports
 * only zod schemas and types.
 */
import { z } from "zod";
import {
  actionSynonymSchema,
  checkResultSchema,
  keyFactSchema,
  lineFactSpanSchema,
  sentenceSchema,
} from "@/src/checker-client/schemas";
import type { ConvertEvent } from "@/src/convert/handler";
import type { ConversionResult, PipelineStage, ProgressEvent } from "@/src/pipeline/types";

const stageSchema = z.enum(["analysing", "rewriting", "checking", "regenerating"]);

const progressSchema = z.object({
  type: z.literal("progress"),
  stage: stageSchema,
  attempt: z.number().int().min(1),
  maxAttempts: z.number().int().min(1),
});

const lineSchema = z.object({
  id: z.string(),
  text: z.string(),
  source_sentence_id: z.string(),
  symbol_id: z.string().nullable(),
});

export const conversionResultSchema = z.object({
  status: z.enum(["passed", "flagged", "blocked"]),
  original: z.object({ text: z.string(), sentences: z.array(sentenceSchema) }),
  keyFacts: z.array(keyFactSchema),
  lines: z.array(lineSchema),
  checks: z.array(checkResultSchema),
  attempts: z.number().int(),
  notice: z.string(),
  judgeAvailable: z.boolean(),
  models: z.array(
    z.object({
      task: z.enum(["rewrite", "regenerate", "judge"]),
      attempt: z.number().int(),
      provider: z.string(),
      model: z.string(),
    }),
  ),
  actionSynonyms: z.array(actionSynonymSchema),
  lineFacts: z.array(lineFactSpanSchema),
});

const resultSchema = z.object({ type: z.literal("result"), result: conversionResultSchema });

const errorSchema = z.object({
  type: z.literal("error"),
  error: z.string(),
  status: z.number().int(),
  message: z.string(),
  retryAfterSeconds: z.number().optional(),
});

const eventSchema = z.discriminatedUnion("type", [progressSchema, resultSchema, errorSchema]);

/** One stream event, or null when the value doesn't match any event shape. */
export function parseConvertEvent(value: unknown): ConvertEvent | null {
  const parsed = eventSchema.safeParse(value);
  if (!parsed.success) return null;
  const event = parsed.data;
  if (event.type === "result") return { type: "result", result: event.result satisfies ConversionResult };
  return event as ConvertEvent;
}

const STAGE_LABELS: Record<PipelineStage, string> = {
  analysing: "Reading the letter",
  rewriting: "Writing the Easy Read version",
  checking: "Checking the Easy Read version",
  regenerating: "Rewriting the lines that failed a check",
};

/**
 * Plain status line. The first try names the stage ("Checking the Easy Read
 * version"); later tries say so, for example "Checking again (try 2 of 3)".
 */
export function progressLabel(event: ProgressEvent): string {
  if (event.stage === "analysing" || event.attempt <= 1) return STAGE_LABELS[event.stage];
  const label = event.stage === "checking" ? "Checking again" : STAGE_LABELS[event.stage];
  return `${label} (try ${event.attempt} of ${event.maxAttempts})`;
}

/**
 * Percentage for the Progress bar. The steps are: analyse, then a write and a
 * check for each try. The bar never reaches 100 before the result arrives.
 */
export function progressValue(event: ProgressEvent): number {
  const maxAttempts = Math.max(1, event.maxAttempts);
  const attempt = Math.min(Math.max(1, event.attempt), maxAttempts);
  const steps = 1 + maxAttempts * 2;
  let index: number;
  if (event.stage === "analysing") index = 0;
  else if (event.stage === "checking") index = 2 + (attempt - 1) * 2;
  else index = 1 + (attempt - 1) * 2;
  return Math.round(((index + 1) / (steps + 1)) * 100);
}

export type StageId = "read" | "write" | "check" | "fix";
export type StageState = "done" | "current" | "pending";

export interface StageRow {
  id: StageId;
  label: string;
  state: StageState;
  /** "Try 2 of 3" on the current Check or Fix row from the second try, otherwise null. */
  tag: string | null;
}

const STAGE_ROWS: { id: StageId; stage: PipelineStage; label: string }[] = [
  { id: "read", stage: "analysing", label: "Reading the letter" },
  { id: "write", stage: "rewriting", label: "Writing the Easy Read version" },
  { id: "check", stage: "checking", label: "Checking the lines" },
  { id: "fix", stage: "regenerating", label: "Fixing lines that failed a check" },
];

/**
 * Rows for the stage list on the input screen. At most 4 rows: the Fix row is
 * shown only once a `regenerating` event has been seen (`sawFix`). Before the
 * first event, Read is current. When Check runs again after a fix, Fix shows
 * as done.
 */
export function stageRows(event: ProgressEvent | null, sawFix: boolean): StageRow[] {
  const current = event === null ? 0 : STAGE_ROWS.findIndex((r) => r.stage === event.stage);
  const showFix = sawFix || event?.stage === "regenerating";
  return STAGE_ROWS.filter((r) => r.id !== "fix" || showFix).map((row, index) => {
    let state: StageState = index < current ? "done" : index === current ? "current" : "pending";
    if (row.id === "fix" && event?.stage === "checking") state = "done";
    const retry = event !== null && event.attempt > 1 && (row.id === "check" || row.id === "fix");
    const tag = state === "current" && retry ? `Try ${event.attempt} of ${event.maxAttempts}` : null;
    return { id: row.id, label: row.label, state, tag };
  });
}
