/**
 * Recorded sample letters (task 29, R3.1, design "Protecting the live quota").
 *
 * Each file in `web/data/samples/` holds a `ConversionResult` recorded from a
 * real run of a public sample letter, plus when it was recorded and which
 * models answered. Loading a sample re-runs P1 to P8 through the checker, with
 * no model call, so the checks shown are current. P9 and P10 are the recorded
 * judge verdicts and are labelled as recorded.
 *
 * Browser-safe: zod schemas, types and label text only.
 */
import { z } from "zod";
import { conversionResultSchema } from "@/src/ui/convert-events";

/** Lowercase letters, digits and dashes. Also the file name without `.json`. */
export const sampleIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

/** One file in `web/data/samples/`. */
export const sampleFileSchema = z.object({
  id: sampleIdSchema,
  /** Shown in the "Try a sample letter" list. */
  label: z.string().min(1).max(120),
  /** The fixture file the letter came from, relative to `fixtures/letters/`. */
  source: z.string().min(1),
  /** ISO 8601 time the result was recorded. */
  recordedAt: z.iso.datetime(),
  /** Every distinct `provider:model` that answered, rewrite model first. */
  models: z.array(z.string().min(1)).min(1),
  /** Only passed or flagged results with lines are stored, never blocked ones. */
  result: conversionResultSchema.refine((r) => r.status !== "blocked" && r.lines.length > 0, {
    message: "a sample must be passed or flagged and hold lines",
  }),
});

export type SampleFile = z.infer<typeof sampleFileSchema>;

/** What the browser gets about a sample: no letter text. */
export const sampleInfoSchema = z.object({
  id: sampleIdSchema,
  label: z.string(),
  recordedAt: z.iso.datetime(),
  models: z.array(z.string()),
});

export type SampleInfo = z.infer<typeof sampleInfoSchema>;

export function sampleInfo(sample: SampleFile): SampleInfo {
  return { id: sample.id, label: sample.label, recordedAt: sample.recordedAt, models: [...sample.models] };
}

/** Distinct `provider:model` names in the order they first answered, rewrite and regenerate before the judge. */
export function modelsOf(models: readonly { task: string; provider: string; model: string }[]): string[] {
  const writing = models.filter((m) => m.task !== "judge");
  const judging = models.filter((m) => m.task === "judge");
  const out: string[] = [];
  for (const m of [...writing, ...judging]) {
    const name = `${m.provider}:${m.model}`;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** "12 May 2026". UTC, so the label is the same on the server and in every browser. */
export function formatRecordedDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(iso),
  );
}

/** "Recorded on 12 May 2026 with groq:openai/gpt-oss-120b and groq:qwen/qwen3.8-27b" */
export function recordedLabel(info: Pick<SampleInfo, "recordedAt" | "models">): string {
  const models =
    info.models.length <= 1
      ? (info.models[0] ?? "an unknown model")
      : `${info.models.slice(0, -1).join(", ")} and ${info.models[info.models.length - 1]}`;
  return `Recorded on ${formatRecordedDate(info.recordedAt)} with ${models}`;
}

/** Shown under the recorded label: which checks ran now and which are from the recording. */
export const RECORDED_CHECKS_NOTE = "Checks P1 to P8 ran again just now. P9 and P10 are from the recording.";
