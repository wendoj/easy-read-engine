"use client";
/**
 * The dates and amounts in the letter, each with a way to its Easy Read line.
 * Starts closed. Values are shown as written in the Original; nothing
 * is reworded or worked out.
 */
import { ScanSearch } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { KeyFact, LineFactSpan } from "@/src/checker-client/schemas";
import { type FactStyle, factClassName } from "@/src/ui/key-fact-highlight";
import { SummaryPanel } from "./summary-panel";

const SHOWN_TYPES: readonly KeyFact["type"][] = ["date", "money"];
const BARE_YEAR = /^\d{4}$/u;
const EXACT_DATE = /^(?:\d{4}|-)-\d{2}(?:-\d{2})?$/u;
const TIME_LIMIT = /^\d+ (?:(?:working|calendar|business|clear) )?(?:day|week|month|year)s?$/u;

/**
 * What to call a fact in the list, from its normalised value: "Date" for a day,
 * "Time limit" for "7 days", "When" for a range like "Monday to Friday". A
 * bare year ("the Planning Act 1990") is part of a name, so it is left out
 * here; P1 still checks it and the lines still highlight it.
 */
export function pointLabel(fact: Pick<KeyFact, "type" | "normalised">): string | null {
  if (fact.type === "money") return "Amount";
  if (fact.type !== "date" || BARE_YEAR.test(fact.normalised)) return null;
  if (EXACT_DATE.test(fact.normalised)) return "Date";
  if (TIME_LIMIT.test(fact.normalised)) return "Time limit";
  return "When";
}

/** A letter can repeat a date many times; the list stays short. */
const MAX_POINTS = 8;

export interface MainPoint {
  factId: string;
  label: string;
  type: KeyFact["type"];
  value: string;
  lineId: string;
  lineNumber: number;
}

/** One point per distinct date or amount, in Easy Read order, each with the first line that holds it. */
export function mainPoints(
  keyFacts: readonly KeyFact[],
  lineFacts: readonly LineFactSpan[],
  lineNumbers: ReadonlyMap<string, number>,
): MainPoint[] {
  const facts = new Map(keyFacts.map((f) => [f.id, f]));
  const seen = new Set<string>();
  const points: MainPoint[] = [];
  const spans = [...lineFacts].sort(
    (a, b) => (lineNumbers.get(a.line_id) ?? Infinity) - (lineNumbers.get(b.line_id) ?? Infinity) || a.start - b.start,
  );
  for (const span of spans) {
    const fact = facts.get(span.fact_id);
    const lineNumber = lineNumbers.get(span.line_id);
    if (!fact || lineNumber === undefined || !SHOWN_TYPES.includes(fact.type)) continue;
    const label = pointLabel(fact);
    if (label === null) continue;
    const key = `${fact.type}\u0000${fact.normalised}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push({ factId: fact.id, label, type: fact.type, value: fact.value, lineId: span.line_id, lineNumber });
  }
  return points.slice(0, MAX_POINTS);
}

export function MainPoints({
  points,
  styles,
  onGoToLine,
}: {
  points: MainPoint[];
  styles: ReadonlyMap<string, FactStyle>;
  onGoToLine: (lineId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (points.length === 0) return null;
  const count = points.length === 1 ? "1 date or amount" : `${points.length} dates and amounts`;
  return (
    <SummaryPanel
      heading="Dates and amounts"
      count={count}
      preview={points
        .slice(0, 2)
        .map((p) => `${p.label}: ${p.value}`)
        .join(". ")}
      open={open}
      onOpenChange={setOpen}
    >
      <ul className="flex flex-col divide-y divide-border">
        {points.map((point) => {
          const style = styles.get(point.factId);
          return (
            <li
              key={point.factId}
              className="flex flex-col items-start gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
            >
              <p className="text-lg leading-normal [overflow-wrap:anywhere]">
                <span className="text-muted-foreground">{point.label}: </span>
                <span className={style ? `${factClassName(style)} font-semibold` : "font-semibold"}>{point.value}</span>
              </p>
              <Button type="button" variant="outline" className="shrink-0" onClick={() => onGoToLine(point.lineId)}>
                <ScanSearch aria-hidden strokeWidth={2} absoluteStrokeWidth data-icon="inline-start" />
                Go to line {point.lineNumber}
              </Button>
            </li>
          );
        })}
      </ul>
    </SummaryPanel>
  );
}
