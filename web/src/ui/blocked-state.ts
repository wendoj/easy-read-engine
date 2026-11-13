// Failed key-fact values are shown on screen but must never be logged.
import type { KeyFact } from "@/src/checker-client/schemas";
import type { ConversionResult } from "@/src/pipeline/types";
import { FACT_TYPE_LABELS, type KeyFactType } from "./key-fact-highlight";
import { type UndoHistory, canUndo } from "./line-edit";

export interface FailedFact {
  id: string;
  type: KeyFactType;
  typeLabel: string;
  /** As written in the Original. */
  value: string;
}

/** P1's failed facts, each once, in Original order. Unknown IDs are dropped. */
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

/** A blocked result the undo history leads to came from an edit. Null when not blocked. */
export function blockSource(result: ConversionResult | null, history: UndoHistory): BlockSource | null {
  if (result === null || result.status !== "blocked") return null;
  return canUndo(history, result) ? "edit" : "conversion";
}

/** Without the judge, P10 (no advice) never ran, so the lines must not leave the screen as if checked. */
export function canExport(result: Pick<ConversionResult, "status" | "lines" | "judgeAvailable"> | null): boolean {
  return result !== null && result.status !== "blocked" && result.lines.length > 0 && result.judgeAvailable;
}

export const NOT_JUDGED_EXPORT_MESSAGE = "You cannot save this yet, because the advice check did not run.";

export const BLOCKED_HEADING = "Easy Read version not shown";

export const BLOCKED_MESSAGES: Record<BlockSource, string> = {
  conversion: "The Easy Read version is not shown, because a key fact in it did not match the letter.",
  edit: "The Easy Read version is not shown, because your edit changed or removed a key fact.",
};

export const FAILED_FACTS_HEADING = "Key facts that did not match";

/** P1 failed but named no key fact this result knows. */
export const NO_FAILED_FACTS_MESSAGE = "The check did not say which key fact did not match.";
