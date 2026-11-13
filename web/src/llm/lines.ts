/** Shared pieces for the rewrite, regenerate and judge calls. */
import { z } from "zod";
import type { KeyFact, Sentence } from "@/src/checker-client/schemas";
import { type PromptTemplate, oneLine } from "./prompts";
import type { StructuredOptions } from "./structured";

export interface LlmCallOptions extends StructuredOptions {
  /** Used instead of the file in `prompts/`. */
  prompt?: PromptTemplate;
}

/** Which provider and model answered one request. */
export interface ModelAnswer {
  provider: string;
  model: string;
}

/** The pipeline adds the line ID and symbol ID. */
export const draftLineSchema = z.object({
  text: z.string().trim().min(1),
  sourceSentenceId: z.string().trim().min(1),
  symbolQuery: z.string().trim().max(60).default(""),
});

export type DraftLine = z.infer<typeof draftLineSchema>;

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
