/**
 * Rewrite: the Original's sentences and key facts to Easy Read draft lines
 * (pipeline step 5). Prompt: `prompts/rewrite.md`.
 */
import { z } from "zod";
import type { KeyFact, Sentence } from "@/src/checker-client/schemas";
import type { ModelClient } from "./client";
import { DRAFT_LINE_PARAMETERS, type DraftLine, draftLineSchema, formatKeyFacts, formatSentences } from "./lines";
import { formatPlainWords } from "./plain-words";
import { type PromptTemplate, loadPrompt, renderTemplate } from "./prompts";
import { type StructuredOptions, type ToolDefinition, callStructured } from "./structured";

/** gpt-oss-120b is capped at 3,000 output tokens by the model client anyway. */
export const REWRITE_MAX_TOKENS = 3000;

export const SUBMIT_LINES_TOOL: ToolDefinition = {
  name: "submit_lines",
  description: "Submit the Easy Read lines for the whole letter, in order.",
  parameters: {
    type: "object",
    properties: { lines: { type: "array", items: DRAFT_LINE_PARAMETERS } },
    required: ["lines"],
  },
};

/** Every line must point at a sentence that exists in the Original. */
export function rewriteSchema(sentenceIds: ReadonlySet<string>) {
  return z.object({
    lines: z
      .array(draftLineSchema)
      .min(1)
      .superRefine((lines, ctx) => {
        lines.forEach((line, i) => {
          if (!sentenceIds.has(line.sourceSentenceId)) {
            ctx.addIssue({ code: "custom", path: [i, "sourceSentenceId"], message: "not a sentence ID from the list" });
          }
        });
      }),
  });
}

export interface RewriteInput {
  sentences: Sentence[];
  keyFacts: KeyFact[];
}

export interface RewriteResult {
  lines: DraftLine[];
  provider: string;
  model: string;
  requests: number;
}

export interface LlmCallOptions extends StructuredOptions {
  /** Prompt to use instead of the file in `prompts/`. */
  prompt?: PromptTemplate;
}

export function buildRewriteMessages(prompt: PromptTemplate, input: RewriteInput): { system: string; user: string } {
  return {
    system: prompt.system,
    user: renderTemplate(prompt.user, {
      sentences: formatSentences(input.sentences),
      key_facts: formatKeyFacts(input.keyFacts),
      plain_words: formatPlainWords(input.sentences.map((s) => s.text)),
    }),
  };
}

/**
 * Most sentences sent in 1 rewrite request. On a 143-sentence letter,
 * gpt-oss-120b often reasoned that the task was too big and answered with
 * almost no lines, so the letter was blocked on P1 (Bedrock run, November
 * 2026). 89 sentences still worked. Longer letters are rewritten in parts.
 */
export const REWRITE_CHUNK_SENTENCES = 60;

/** Split `sentences`, in order, into the fewest parts of at most `size`, of near-equal length. */
export function chunkSentences<T>(sentences: readonly T[], size: number = REWRITE_CHUNK_SENTENCES): T[][] {
  if (sentences.length <= size) return [[...sentences]];
  const parts = Math.ceil(sentences.length / size);
  const each = Math.ceil(sentences.length / parts);
  const chunks: T[][] = [];
  for (let i = 0; i < sentences.length; i += each) chunks.push(sentences.slice(i, i + each));
  return chunks;
}

/**
 * Rewrites the letter in 1 request, or in parts of at most
 * `REWRITE_CHUNK_SENTENCES` sentences, one after another. Each part gets only
 * its own sentences and key facts, and its lines may point only at its own
 * sentences. The lines are joined in letter order.
 */
export async function rewrite(
  client: ModelClient,
  input: RewriteInput,
  options: LlmCallOptions = {},
): Promise<RewriteResult> {
  const prompt = options.prompt ?? (await loadPrompt("rewrite"));
  const lines: DraftLine[] = [];
  let requests = 0;
  let answeredBy = { provider: "", model: "" };
  for (const sentences of chunkSentences(input.sentences)) {
    const ids = new Set(sentences.map((s) => s.id));
    const keyFacts = input.keyFacts.filter((f) => ids.has(f.sentence_id));
    const { system, user } = buildRewriteMessages(prompt, { sentences, keyFacts });
    const result = await callStructured(
      client,
      {
        task: "rewrite",
        role: "rewrite",
        system,
        user,
        tool: SUBMIT_LINES_TOOL,
        schema: rewriteSchema(ids),
        maxTokens: REWRITE_MAX_TOKENS,
        temperature: 0.2,
      },
      options,
    );
    lines.push(...result.data.lines);
    requests += result.requests;
    answeredBy = { provider: result.provider, model: result.model };
  }
  return { lines, ...answeredBy, requests };
}
