/**
 * zod schemas for checker responses, validated at the boundary (tech.md).
 *
 * The generated types in `@/src/types/checker` are the contract. Each schema
 * below is checked against its generated type at compile time (`Exact`), so a
 * change to the Pydantic models that isn't mirrored here fails `tsc`.
 */
import { z } from "zod";
import type { components } from "@/src/types/checker";

type Schemas = components["schemas"];

export type Sentence = Schemas["Sentence"];
export type KeyFact = Schemas["KeyFact"];
export type Line = Schemas["Line"];
export type Analysis = Schemas["Analysis"];
export type CheckResult = Schemas["CheckResult"];
export type SymbolMatch = Schemas["SymbolMatch"];
export type Health = Schemas["Health"];
export type ValidationIssue = Schemas["ValidationIssue"];
export type CheckRequest = Schemas["CheckRequest"];
export type ActionSynonym = Schemas["ActionSynonym"];
export type LineFactSpan = Schemas["LineFactSpan"];
export type LineFactsRequest = Schemas["LineFactsRequest"];

export const sentenceSchema = z.object({
  id: z.string(),
  text: z.string(),
  start: z.number().int(),
  end: z.number().int(),
});

export const keyFactSchema = z.object({
  id: z.string(),
  type: z.enum(["date", "time", "money", "reference", "phone", "address", "action"]),
  value: z.string(),
  normalised: z.string(),
  start: z.number().int(),
  end: z.number().int(),
  sentence_id: z.string(),
});

export const analysisSchema = z.object({
  sentences: z.array(sentenceSchema),
  key_facts: z.array(keyFactSchema),
});

export const checkResultSchema = z.object({
  rule: z.enum(["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"]),
  passed: z.boolean(),
  line_ids: z.array(z.string()),
  failed_fact_ids: z.array(z.string()),
  details: z.array(z.string()),
});

export const symbolMatchSchema = z.object({
  id: z.string(),
  score: z.number(),
});

/** One entry of P1's action synonym table (`ACTION_SYNONYMS` in checker/src/checks/config.py). */
export const actionSynonymSchema = z.object({
  word: z.string(),
  counts_as: z.string(),
});

/** Where a key fact from the Original appears in one line (`POST /line-facts`). Offsets into the line text. */
export const lineFactSpanSchema = z.object({
  line_id: z.string(),
  fact_id: z.string(),
  start: z.number().int(),
  end: z.number().int(),
});

export const healthSchema = z.object({
  status: z.enum(["ok", "starting"]),
  spacy_loaded: z.boolean(),
  spacy_model: z.string(),
  symbol_index_loaded: z.boolean(),
});

export const validationErrorSchema = z.object({
  detail: z.array(
    z.object({
      loc: z.array(z.union([z.string(), z.number()])),
      type: z.string(),
    }),
  ),
});

// --- compile-time drift check against the generated types ---------------------

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

export type _SchemaMatchesGenerated = [
  Assert<Exact<z.infer<typeof sentenceSchema>, Sentence>>,
  Assert<Exact<z.infer<typeof keyFactSchema>, KeyFact>>,
  Assert<Exact<z.infer<typeof analysisSchema>, Analysis>>,
  Assert<Exact<z.infer<typeof checkResultSchema>, CheckResult>>,
  Assert<Exact<z.infer<typeof symbolMatchSchema>, SymbolMatch>>,
  Assert<Exact<z.infer<typeof actionSynonymSchema>, ActionSynonym>>,
  Assert<Exact<z.infer<typeof lineFactSpanSchema>, LineFactSpan>>,
  Assert<Exact<z.infer<typeof healthSchema>, Health>>,
  Assert<Exact<z.infer<typeof validationErrorSchema>["detail"][number], ValidationIssue>>,
];
