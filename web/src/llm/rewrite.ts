/**
 * Rewrite: the Original's sentences and key facts to Easy Read draft lines
 * (pipeline step 5). Prompt: `prompts/rewrite.md`.
 */
import { z } from "zod";
import type { KeyFact, Sentence } from "@/src/checker-client/schemas";
import type { ModelClient } from "./client";
import { DRAFT_LINE_PARAMETERS, type DraftLine, draftLineSchema, formatKeyFacts, formatSentences } from "./lines";
import { formatPlainWords } from "./plain-words";
import type { ModelAnswer } from "./judge";
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
  /** The last part's answer. */
  provider: string;
  model: string;
  /** Who answered each part, in order. A fake may leave it out. */
  answers?: ModelAnswer[];
  requests: number;
}

export interface LlmCallOptions extends StructuredOptions {
  /** Prompt to use instead of the file in `prompts/`. */
  prompt?: PromptTemplate;
}

/** Said when the request holds the whole letter, or the first part has no context to add. */
export const NO_CONTEXT = "None. These are all the sentences.";

/**
 * Builds the rewrite messages. `context` is sentences from other parts of
 * the letter, shown so the model knows who sent it. They are not rewritten:
 * `rewriteSchema` takes only the part's own sentence IDs.
 */
export function buildRewriteMessages(
  prompt: PromptTemplate,
  input: RewriteInput,
  context: readonly Sentence[] = [],
): { system: string; user: string } {
  return {
    system: prompt.system,
    user: renderTemplate(prompt.user, {
      sentences: formatSentences(input.sentences),
      key_facts: formatKeyFacts(input.keyFacts),
      plain_words: formatPlainWords(input.sentences.map((s) => s.text)),
      context: context.length > 0 ? formatSentences([...context]) : NO_CONTEXT,
    }),
  };
}

/** Sentences from the start and the end of the letter that every part sees as context. */
export const REWRITE_CONTEXT_START = 5;
export const REWRITE_CONTEXT_END = 3;

/**
 * Context for 1 part: the letter's first `REWRITE_CONTEXT_START` and last
 * `REWRITE_CONTEXT_END` sentences that are not in the part. The letterhead
 * and the sign-off name the sender, so a later part can write "The council"
 * for "we", as the prompt asks. Empty when the letter is not split.
 */
export function rewriteContext(all: readonly Sentence[], part: readonly Sentence[]): Sentence[] {
  if (part.length === all.length) return [];
  const own = new Set(part.map((s) => s.id));
  const start = all.slice(0, REWRITE_CONTEXT_START);
  const end = all.slice(Math.max(REWRITE_CONTEXT_START, all.length - REWRITE_CONTEXT_END));
  return [...start, ...end].filter((s) => !own.has(s.id));
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
 * `REWRITE_CHUNK_SENTENCES` sentences, one after another. Each part gets its
 * own sentences and key facts, and its lines may point only at its own
 * sentences. It also sees the start and end of the letter as context only
 * (`rewriteContext`). The lines are joined in letter order, and `answers`
 * records who answered each part.
 */
export async function rewrite(
  client: ModelClient,
  input: RewriteInput,
  options: LlmCallOptions = {},
): Promise<RewriteResult> {
  const prompt = options.prompt ?? (await loadPrompt("rewrite"));
  const lines: DraftLine[] = [];
  let requests = 0;
  const answers: ModelAnswer[] = [];
  for (const sentences of chunkSentences(input.sentences)) {
    const ids = new Set(sentences.map((s) => s.id));
    const keyFacts = input.keyFacts.filter((f) => ids.has(f.sentence_id));
    const context = rewriteContext(input.sentences, sentences);
    const { system, user } = buildRewriteMessages(prompt, { sentences, keyFacts }, context);
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
    answers.push({ provider: result.provider, model: result.model });
  }
  const last = answers.at(-1) ?? { provider: "", model: "" };
  return { lines, ...last, answers, requests };
}
