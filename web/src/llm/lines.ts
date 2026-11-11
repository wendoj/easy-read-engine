/** Shared pieces for the rewrite and regenerate calls. */
import { z } from "zod";
import type { KeyFact, Sentence } from "@/src/checker-client/schemas";
import { oneLine } from "./prompts";

/** One Easy Read line as the model returns it. The pipeline adds the line ID and symbol ID. */
export const draftLineSchema = z.object({
  text: z.string().trim().min(1),
  sourceSentenceId: z.string().trim().min(1),
  symbolQuery: z.string().trim().max(60).default(""),
});

export type DraftLine = z.infer<typeof draftLineSchema>;

/** JSON schema for one draft line, used in tool definitions. */
export const DRAFT_LINE_PARAMETERS = {
  type: "object",
  properties: {
    text: { type: "string", description: "One short Easy Read sentence" },
    sourceSentenceId: { type: "string", description: "ID of the source sentence, for example s4" },
    symbolQuery: { type: "string", description: "1 or 2 common words for a picture, or an empty string" },
  },
  required: ["text", "sourceSentenceId", "symbolQuery"],
} as const;

export function formatSentences(sentences: Sentence[]): string {
  if (sentences.length === 0) return "(none)";
  return sentences.map((s) => `${s.id}: ${oneLine(s.text)}`).join("\n");
}

export function formatKeyFacts(keyFacts: KeyFact[]): string {
  if (keyFacts.length === 0) return "(none)";
  return keyFacts.map((f) => `${f.id} (${f.type}, from ${f.sentence_id}): ${oneLine(f.value)}`).join("\n");
}
