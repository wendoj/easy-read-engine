/**
 * The model gets only the failing lines, the rules each one failed with the
 * checker's details, their source sentences and the key facts from those
 * sentences. It returns replacement lines for those line IDs, and new lines
 * for key facts that no line holds.
 */
import { z } from "zod";
import type { CheckResult, KeyFact, Line, Sentence } from "@/src/checker-client/schemas";
import type { ModelClient } from "./client";
import {
  DRAFT_LINE_PARAMETERS,
  type DraftLine,
  type LlmCallOptions,
  draftLineSchema,
  formatKeyFacts,
  formatSentences,
} from "./lines";
import { formatPlainWords } from "./plain-words";
import { type PromptTemplate, loadPrompt, oneLine, renderPrompt } from "./prompts";
import { type ToolDefinition, callStructured } from "./structured";

export const REGENERATE_MAX_TOKENS = 2000;

export type Rule = CheckResult["rule"];

export interface LineFailure {
  rule: Rule;
  /** Never letter values for P1 to P8. */
  details: string[];
}

export interface FailingLine {
  line: Line;
  failures: LineFailure[];
}

export interface RegenerateInput {
  failing: FailingLine[];
  /** All sentences of the Original. Only the ones the failing lines and missing facts need are sent. */
  sentences: Sentence[];
  /** All key facts of the Original. Only the ones in those sentences are sent. */
  keyFacts: KeyFact[];
  /** Key facts that no line holds. The model adds a line for each. */
  missingFacts?: KeyFact[];
}

export interface Replacement {
  lineId: string;
  lines: DraftLine[];
}

export interface RegenerateResult {
  /** One entry per failing line, in the order given. */
  replacements: Replacement[];
  /** New lines for missing key facts. */
  added: DraftLine[];
  provider: string;
  model: string;
  requests: number;
}

const P1_FACT_ID = /^(\S+) \(/;
const p1FactId = (detail: string) => detail.match(P1_FACT_ID)?.[1];

/**
 * A detail belongs to a line when it starts with that line's ID, as every
 * checker writes them. P1 details start with a fact ID instead, so they go to
 * lines from that fact's sentence, or to every P1 line if the fact's sentence
 * has no line.
 */
export function collectFailures(lines: Line[], checks: CheckResult[], keyFacts: KeyFact[]): FailingLine[] {
  const factSentence = new Map(keyFacts.map((f) => [f.id, f.sentence_id]));
  const out: FailingLine[] = [];
  for (const line of lines) {
    const failures: LineFailure[] = [];
    for (const check of checks) {
      if (check.passed || !check.line_ids.includes(line.id)) continue;
      let details: string[];
      if (check.rule === "P1") {
        const own = check.details.filter((d) => {
          const id = p1FactId(d);
          return id !== undefined && factSentence.get(id) === line.source_sentence_id;
        });
        details = own.length > 0 ? own : check.details;
      } else {
        details = check.details.filter((d) => d.startsWith(`${line.id} `) || d.startsWith(`${line.id}:`));
      }
      failures.push({ rule: check.rule, details });
    }
    if (failures.length > 0) out.push({ line, failures });
  }
  return out;
}

export const SUBMIT_REPLACEMENTS_TOOL: ToolDefinition = {
  name: "submit_replacements",
  description: "Submit replacement lines for each failing line, and new lines for missing key facts.",
  parameters: {
    type: "object",
    properties: {
      replacements: {
        type: "array",
        items: {
          type: "object",
          properties: {
            lineId: { type: "string", description: "ID of the failing line, for example L3" },
            lines: { type: "array", items: DRAFT_LINE_PARAMETERS },
          },
          required: ["lineId", "lines"],
        },
      },
      added: { type: "array", items: DRAFT_LINE_PARAMETERS },
    },
    required: ["replacements", "added"],
  },
};

/**
 * The shape is strict; the line IDs are not. With 30 or more failing lines
 * the model often mislabels or skips one, and rejecting the whole reply threw
 * away every good replacement. So:
 *
 * - a replacement for an ID that isn't failing, or a second one for the same
 *   ID, is dropped (the first wins);
 * - a failing line with no replacement keeps its text (`applyRegeneration`)
 *   and is checked again on the next try;
 * - an added line for a sentence that has no missing key fact is dropped.
 *
 * Only a reply with nothing usable in it is invalid, so it gets the one retry.
 */
export function regenerateSchema(failingIds: readonly string[], addableSentenceIds: ReadonlySet<string>) {
  const wanted = new Set(failingIds);
  return z
    .object({
      replacements: z.array(z.object({ lineId: z.string().trim(), lines: z.array(draftLineSchema).min(1) })),
      added: z.array(draftLineSchema).default([]),
    })
    .transform((value) => {
      const seen = new Set<string>();
      const replacements = value.replacements.filter((r) => {
        if (!wanted.has(r.lineId) || seen.has(r.lineId)) return false;
        seen.add(r.lineId);
        return true;
      });
      const added = value.added.filter((line) => addableSentenceIds.has(line.sourceSentenceId));
      return { replacements, added };
    })
    .superRefine((value, ctx) => {
      if (value.replacements.length === 0 && value.added.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["replacements"],
          message:
            failingIds.length > 0
              ? "a failing line ID has no replacement"
              : "not the sentence ID of a missing key fact",
        });
      }
    });
}

function formatFailingLines(failing: FailingLine[]): string {
  return failing
    .map(({ line, failures }) => {
      const reasons = failures.flatMap((f) =>
        f.details.length > 0 ? f.details.map((d) => `  - ${f.rule}: ${oneLine(d)}`) : [`  - ${f.rule}`],
      );
      return [`${line.id} (from ${line.source_sentence_id}): ${oneLine(line.text)}`, ...reasons].join("\n");
    })
    .join("\n\n");
}

/** Only the sentences and key facts the regenerate prompt needs. */
export function selectContext(input: RegenerateInput): { sentences: Sentence[]; keyFacts: KeyFact[] } {
  const missing = input.missingFacts ?? [];
  const sentenceIds = new Set([
    ...input.failing.map((f) => f.line.source_sentence_id),
    ...missing.map((f) => f.sentence_id),
  ]);
  const namedFactIds = new Set(
    input.failing.flatMap((f) =>
      f.failures
        .filter((x) => x.rule === "P1")
        .flatMap((x) => x.details.map(p1FactId).filter((id): id is string => !!id)),
    ),
  );
  return {
    sentences: input.sentences.filter((s) => sentenceIds.has(s.id)),
    keyFacts: input.keyFacts.filter((f) => sentenceIds.has(f.sentence_id) || namedFactIds.has(f.id)),
  };
}

export function buildRegenerateMessages(
  prompt: PromptTemplate,
  input: RegenerateInput,
): { system: string; user: string } {
  const { sentences, keyFacts } = selectContext(input);
  return renderPrompt(prompt, {
    failing_lines: formatFailingLines(input.failing),
    sentences: formatSentences(sentences),
    key_facts: formatKeyFacts(keyFacts),
    missing_facts: formatKeyFacts(input.missingFacts ?? []),
    plain_words: formatPlainWords([...input.failing.map((f) => f.line.text), ...sentences.map((s) => s.text)]),
  });
}

export async function regenerate(
  client: ModelClient,
  input: RegenerateInput,
  options: LlmCallOptions = {},
): Promise<RegenerateResult> {
  const failingIds = input.failing.map((f) => f.line.id);
  const missing = input.missingFacts ?? [];
  if (failingIds.length === 0 && missing.length === 0) {
    return { replacements: [], added: [], provider: "", model: "", requests: 0 };
  }
  const prompt = options.prompt ?? (await loadPrompt("regenerate"));
  const { system, user } = buildRegenerateMessages(prompt, input);
  const result = await callStructured(
    client,
    {
      task: "regenerate",
      role: "rewrite",
      system,
      user,
      tool: SUBMIT_REPLACEMENTS_TOOL,
      schema: regenerateSchema(failingIds, new Set(missing.map((f) => f.sentence_id))),
      maxTokens: REGENERATE_MAX_TOKENS,
      temperature: 0.2,
    },
    options,
  );
  // A replacement stays on the failing line's source sentence, so the line keeps its trace to the Original.
  const byId = new Map(result.data.replacements.map((r) => [r.lineId, r.lines]));
  const replacements = input.failing.map(({ line }) => ({
    lineId: line.id,
    lines: (byId.get(line.id) ?? []).map((l) => ({ ...l, sourceSentenceId: line.source_sentence_id })),
  }));
  return {
    replacements,
    added: result.data.added,
    provider: result.provider,
    model: result.model,
    requests: result.requests,
  };
}
