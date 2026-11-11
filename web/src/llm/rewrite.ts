/**
 * Rewrite: the Original's sentences and key facts to Easy Read draft lines
 * (pipeline step 5). Prompt: `prompts/rewrite.md`.
 */
import { z } from "zod";
import type { KeyFact, Sentence } from "@/src/checker-client/schemas";
import type { ModelClient } from "./client";
import { DRAFT_LINE_PARAMETERS, type DraftLine, draftLineSchema, formatKeyFacts, formatSentences } from "./lines";
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
    }),
  };
}

export async function rewrite(
  client: ModelClient,
  input: RewriteInput,
  options: LlmCallOptions = {},
): Promise<RewriteResult> {
  const prompt = options.prompt ?? (await loadPrompt("rewrite"));
  const { system, user } = buildRewriteMessages(prompt, input);
  const result = await callStructured(
    client,
    {
      task: "rewrite",
      role: "rewrite",
      system,
      user,
      tool: SUBMIT_LINES_TOOL,
      schema: rewriteSchema(new Set(input.sentences.map((s) => s.id))),
      maxTokens: REWRITE_MAX_TOKENS,
      temperature: 0.2,
    },
    options,
  );
  return { lines: result.data.lines, provider: result.provider, model: result.model, requests: result.requests };
}
