/**
 * Pure logic behind the blocked state (task 27, R2.5, R9.3, R9.5).
 *
 * - `failedKeyFacts` lists the key facts P1 names as failed, with the values
 *   from the Original. Showing them on screen is the point of R2.5; they are
 *   never logged (R7.4), and nothing here logs.
 * - `blockSource` says whether the block came from a user edit (offer "Undo
 *   edit") or from the conversion (offer "Start again").
 * - `canExport` is false whenever the result is blocked (R9.5). Task 28's
 *   Export button uses it.
 */
import type { KeyFact } from "@/src/checker-client/schemas";
import type { ConversionResult } from "@/src/pipeline/types";
import { FACT_TYPE_LABELS, type KeyFactType } from "./key-fact-highlight";
import { type UndoHistory, canUndo } from "./line-edit";

/** One key fact P1 couldn't find unchanged in the Easy Read version. */
export interface FailedFact {
  id: string;
  type: KeyFactType;
  /** "date", "amount", "phone number" and so on. */
  typeLabel: string;
  /** The value as written in the Original. */
  value: string;
}

/**
 * The key facts named in P1's `failed_fact_ids`, each once, in the order they
 * appear in the Original. IDs that aren't in `result.keyFacts` are dropped.
 */
export function failedKeyFacts(result: Pick<ConversionResult, "checks" | "keyFacts">): FailedFact[] {
  const failedIds = new Set(result.checks.find((c) => c.rule === "P1")?.failed_fact_ids ?? []);
  const byId = new Map<string, { fact: KeyFact; index: number }>();
  result.keyFacts.forEach((fact, index) => {
    if (failedIds.has(fact.id) && !byId.has(fact.id)) byId.set(fact.id, { fact, index });
  });
  return [...byId.values()]
    .sort((a, b) => a.fact.start - b.fact.start || a.index - b.index)
    .map(({ fact }) => ({ id: fact.id, type: fact.type, typeLabel: FACT_TYPE_LABELS[fact.type], value: fact.value }));
}

export type BlockSource = "edit" | "conversion";

/**
 * Where the block came from, or null when the result isn't blocked. A blocked
 * result that the undo history leads to came from an edit; any other blocked
 * result came from the conversion.
 */
export function blockSource(result: ConversionResult | null, history: UndoHistory): BlockSource | null {
  if (result === null || result.status !== "blocked") return null;
  return canUndo(history, result) ? "edit" : "conversion";
}

/** False when there is no result or it is blocked (R9.5). */
export function canExport(result: Pick<ConversionResult, "status" | "lines"> | null): boolean {
  return result !== null && result.status !== "blocked" && result.lines.length > 0;
}

export const BLOCKED_HEADING = "Easy Read version not shown";

export const BLOCKED_MESSAGES: Record<BlockSource, string> = {
  conversion: "The Easy Read version is not shown, because a key fact in it did not match the letter.",
  edit: "The Easy Read version is not shown, because your edit changed or removed a key fact.",
};

export const FAILED_FACTS_HEADING = "Key facts that did not match";

/** Shown when P1 failed but named no key fact this result knows. */
export const NO_FAILED_FACTS_MESSAGE = "The check did not say which key fact did not match.";
