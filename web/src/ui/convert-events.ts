/**
 * Validates the events in the `/api/convert` stream and turns progress events
 * into a label and a percentage for the input screen. Browser-safe: imports
 * only zod schemas and types.
 */
import { z } from "zod";
import { actionSynonymSchema, checkResultSchema, keyFactSchema, sentenceSchema } from "@/src/checker-client/schemas";
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

/** Plain status line, for example "Checking the Easy Read version, try 2 of 3". */
export function progressLabel(event: ProgressEvent): string {
  const label = STAGE_LABELS[event.stage];
  return event.stage === "analysing" ? label : `${label}, try ${event.attempt} of ${event.maxAttempts}`;
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
