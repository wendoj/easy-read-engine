"use client";
/**
 * The Checks strip and the check report. Failed lines also carry a "Check this
 * line" flag in the Easy Read column; the report lists every failure in one
 * place, in plain words, with each line named by its number on screen.
 */
import { ArrowDown, ChevronRight, CircleCheck } from "lucide-react";
import { useRef, useState } from "react";
import { ProblemIcon } from "@/components/status-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { ActionSynonym } from "@/src/checker-client/schemas";
import { type ReportInput, type RuleRow, factSummary, passCount, ruleRows } from "@/src/ui/rule-report";

function ResultBadge({ row }: { row: RuleRow }) {
  return (
    <Badge variant={row.passed ? "secondary" : "destructive"} className="h-9 shrink-0 px-3 text-lg font-semibold">
      {row.resultLabel}
    </Badge>
  );
}

/** One check: its name, its result, and every reason with a link to its line. */
function RuleSection({ row, onGoToLine }: { row: RuleRow; onGoToLine: (lineId: string) => void }) {
  const headingId = `rule-${row.rule}`;
  return (
    <li className="flex flex-col gap-3 py-5 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-4">
        <h3 id={headingId} className="text-[22px] leading-tight font-semibold">
          {row.name} <span className="font-normal text-muted-foreground">({row.rule})</span>
        </h3>
        <ResultBadge row={row} />
      </div>
      {(row.failedFacts.length > 0 || row.items.length > 0) && (
        <ul className="flex flex-col gap-2 text-lg leading-normal [overflow-wrap:anywhere]">
          {row.failedFacts.map((f) => (
            <li key={f.id}>
              <span className="font-semibold">{f.label} in the letter: </span>
              {f.value}
            </li>
          ))}
          {row.items.map((item, i) => (
            <li key={i} className="flex flex-col items-start gap-1 sm:flex-row sm:items-baseline sm:gap-3">
              {item.line !== null && (
                <button
                  type="button"
                  aria-label={`Go to line ${item.line.number}`}
                  onClick={() => onGoToLine(item.line!.id)}
                  className="inline-flex min-h-12 shrink-0 items-center font-semibold whitespace-nowrap text-link underline underline-offset-4 hover:decoration-2"
                >
                  {item.line.label}
                </button>
              )}
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function SynonymList({ synonyms }: { synonyms: ActionSynonym[] }) {
  return (
    <section aria-labelledby="synonyms-heading" className="flex flex-col gap-2">
      <h3 id="synonyms-heading" className="text-[22px] leading-tight font-semibold">
        Words counted as the same action
      </h3>
      {synonyms.length === 0 ? (
        <p className="text-lg text-muted-foreground">None</p>
      ) : (
        <ul className="flex flex-col gap-1 text-lg">
          {synonyms.map((s) => (
            <li key={s.word}>
              <span className="font-semibold">{s.word}</span> counts as <span className="font-semibold">{s.counts_as}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** "All 10 checks passed", or how many found something, pointing at the line flags. */
function countText(passed: number, total: number): string {
  if (passed === total) return `All ${total} checks passed.`;
  const failed = total - passed;
  return `${failed} of ${total} checks found lines to look at again. Those lines have a flag.`;
}

export function RuleReport({
  input,
  synonyms,
  onGoToLine,
  recording,
  firstToCheck = null,
}: {
  input: ReportInput;
  synonyms: ActionSynonym[];
  /** Called after the report has closed. */
  onGoToLine: (lineId: string) => void;
  /** For a sample: when it was recorded and which models answered. */
  recording?: React.ReactNode;
  /** The first flagged line, for "Go to the first line to check". */
  firstToCheck?: { id: string; number: number } | null;
}) {
  const count = passCount(input);
  const rows = ruleRows(input);
  const facts = factSummary(input);
  const [open, setOpen] = useState(false);
  // The line to go to once the sheet has closed.
  const pending = useRef<string | null>(null);
  const goTo = (lineId: string) => {
    pending.current = lineId;
    setOpen(false);
  };
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <section
        aria-label="Checks"
        className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-6"
      >
        <div className="flex items-start gap-3">
          {facts.matched ? (
            <CircleCheck aria-hidden strokeWidth={2} absoluteStrokeWidth className="mt-0.5 size-7 shrink-0 text-pass" />
          ) : (
            <ProblemIcon strong className="mt-0.5 size-7 shrink-0 text-destructive" />
          )}
          <div className="flex flex-col gap-1">
            <p className={facts.matched ? "text-xl leading-snug font-semibold text-pass" : "text-xl leading-snug font-semibold text-destructive"}>
              {facts.label}
            </p>
            {facts.detail && <p className="text-lg leading-snug text-muted-foreground">{facts.detail}</p>}
            <p className="text-lg leading-snug">{countText(count.passed, count.total)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 sm:shrink-0 sm:flex-col sm:items-end">
          {firstToCheck !== null && (
            <Button variant="outline" className="w-fit" onClick={() => onGoToLine(firstToCheck.id)}>
              <ArrowDown aria-hidden strokeWidth={2} absoluteStrokeWidth data-icon="inline-start" />
              Go to the first line to check
            </Button>
          )}
          <SheetTrigger asChild>
            <Button variant="outline" className="w-fit">
              See the check report
              <ChevronRight aria-hidden strokeWidth={2} absoluteStrokeWidth data-icon="inline-end" />
            </Button>
          </SheetTrigger>
        </div>
      </section>
      <SheetContent
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          const lineId = pending.current;
          if (lineId === null) return;
          // Focus goes to the line, not back to the report button.
          pending.current = null;
          event.preventDefault();
          onGoToLine(lineId);
        }}
        className="w-full gap-6 overflow-y-auto overscroll-contain bg-background data-[side=right]:w-full data-[side=right]:sm:max-w-3xl sm:rounded-l-[20px]"
      >
        <SheetHeader className="pr-12">
          <SheetTitle className="text-[28px] leading-tight font-semibold">Check report</SheetTitle>
          <p className="text-lg">{count.label}</p>
        </SheetHeader>
        <div className="flex flex-col gap-8 px-4 pb-6">
          <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-card p-5 sm:p-6">
            {rows.map((row) => (
              <RuleSection key={row.rule} row={row} onGoToLine={goTo} />
            ))}
          </ul>
          <SynonymList synonyms={synonyms} />
          {recording}
        </div>
      </SheetContent>
    </Sheet>
  );
}
