"use client";
/**
 * Pass count and rule report panel (task 24, R3.4, R6.1 to R6.3).
 *
 * A "Checks" strip leads with the key-fact result (P1), then the pass count
 * and a "See the check report" button that opens the report in a Sheet. The report
 * lists every rule with its result, the lines it applied to and its reasons,
 * then P1's action synonym table. Failed rules are red and also say "Failed",
 * so colour is never the only signal. The logic is in `src/ui/rule-report.ts`.
 *
 * Lines on screen carry no failed-rule badge, so this report is where a carer
 * finds failures (R3.4). Each line number is a button: it closes the report,
 * then `onGoToLine` scrolls to that line, focuses it and selects it.
 */
import { ChevronRight, CircleCheck } from "lucide-react";
import { useRef, useState } from "react";
import { ProblemIcon } from "@/components/status-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ActionSynonym } from "@/src/checker-client/schemas";
import { type ReportInput, type RuleRow, factSummary, passCount, ruleRows } from "@/src/ui/rule-report";
import { cn } from "cn";

function ResultBadge({ row }: { row: RuleRow }) {
  return (
    <Badge variant={row.passed ? "secondary" : "destructive"} className="h-9 px-3 text-lg font-semibold">
      {row.resultLabel}
    </Badge>
  );
}

function Reasons({ row }: { row: RuleRow }) {
  const items = [...row.failedFacts.map((f) => `${f.label}: ${f.value}`), ...row.reasons];
  if (items.length === 0) return <span className="text-muted-foreground">None</span>;
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function LineLinks({ row, onGoToLine }: { row: RuleRow; onGoToLine: (lineId: string) => void }) {
  if (row.lines.length === 0) return <span className="text-muted-foreground">None</span>;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1">
      {row.lines.map((line) => (
        <li key={line.id}>
          <button
            type="button"
            aria-label={`Go to line ${line.number}`}
            onClick={() => onGoToLine(line.id)}
            className="min-h-11 text-link underline underline-offset-4 hover:no-underline"
          >
            {line.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

function RulesTable({ rows, onGoToLine }: { rows: RuleRow[]; onGoToLine: (lineId: string) => void }) {
  return (
    <Table className="text-lg">
      <TableHeader>
        <TableRow>
          <TableHead>Check</TableHead>
          <TableHead>Result</TableHead>
          <TableHead>Lines</TableHead>
          <TableHead>Reasons</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.rule} className={cn(!row.passed && "bg-destructive/5 text-destructive")}>
            <TableCell className="align-top font-semibold whitespace-normal">
              {row.rule}. {row.name}
            </TableCell>
            <TableCell className="align-top">
              <ResultBadge row={row} />
            </TableCell>
            <TableCell className="align-top whitespace-normal">
              <LineLinks row={row} onGoToLine={onGoToLine} />
            </TableCell>
            <TableCell className="align-top whitespace-normal">
              <Reasons row={row} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SynonymTable({ synonyms }: { synonyms: ActionSynonym[] }) {
  return (
    <section aria-labelledby="synonyms-heading" className="flex flex-col gap-2">
      <h3 id="synonyms-heading" className="text-[22px] leading-tight font-semibold">
        Words P1 counts as the same action
      </h3>
      {synonyms.length === 0 ? (
        <p className="text-muted-foreground">None</p>
      ) : (
        <Table className="text-lg">
          <TableHeader>
            <TableRow>
              <TableHead>Word</TableHead>
              <TableHead>Counts as</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {synonyms.map((s) => (
              <TableRow key={s.word}>
                <TableCell>{s.word}</TableCell>
                <TableCell>{s.counts_as}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

export function RuleReport({
  input,
  synonyms,
  onGoToLine,
}: {
  input: ReportInput;
  synonyms: ActionSynonym[];
  /** Called after the report has closed, with the line to go to. */
  onGoToLine: (lineId: string) => void;
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
      {/*
        The key-fact result leads: it is the promise that matters most (no
        date, amount or instruction changed). The pass count stays in plain
        words beside it, and the report button opens every rule (R3.4). A
        failed P1 is red with an icon, so colour is never the only signal.
      */}
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
            <p className={cn("text-xl leading-snug font-semibold", facts.matched ? "text-pass" : "text-destructive")}>
              {facts.label}
            </p>
            {facts.detail && <p className="text-lg leading-snug text-muted-foreground">{facts.detail}</p>}
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 sm:shrink-0 sm:items-end">
          <p className="text-lg leading-snug">{count.label}</p>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm">
              See the check report
              <ChevronRight aria-hidden strokeWidth={2} absoluteStrokeWidth data-icon="inline-end" />
            </Button>
          </SheetTrigger>
        </div>
      </section>
      {/* No description: the title and the tables say what this is (ui.md). */}
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
        </SheetHeader>
        <div className="flex flex-col gap-8 px-4 pb-6">
          <RulesTable rows={rows} onGoToLine={goTo} />
          <SynonymTable synonyms={synonyms} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
