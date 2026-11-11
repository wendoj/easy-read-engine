"use client";
/**
 * Pass count and rule report panel (task 24, R3.4, R6.1 to R6.3).
 *
 * The pass count is a button that opens the report in a Sheet. The report
 * lists every rule with its result, the lines it applied to and its reasons,
 * then P1's action synonym table. Failed rules are red and also say "Failed",
 * so colour is never the only signal. The logic is in `src/ui/rule-report.ts`.
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ActionSynonym } from "@/src/checker-client/schemas";
import { type ReportInput, type RuleRow, passCount, ruleRows } from "@/src/ui/rule-report";
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

function RulesTable({ rows }: { rows: RuleRow[] }) {
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
              {row.lines.length > 0 ? row.lines.join(", ") : <span className="text-muted-foreground">None</span>}
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

export function RuleReport({ input, synonyms }: { input: ReportInput; synonyms: ActionSynonym[] }) {
  const count = passCount(input);
  const rows = ruleRows(input);
  const allPassed = count.passed === count.total;
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant={allPassed ? "outline" : "destructive"}>
          {count.label}
        </Button>
      </SheetTrigger>
      {/* No description: the title and the tables say what this is (ui.md). */}
      <SheetContent
        aria-describedby={undefined}
        className="w-full gap-6 overflow-y-auto overscroll-contain bg-background data-[side=right]:w-full data-[side=right]:sm:max-w-3xl sm:rounded-l-[20px]"
      >
        <SheetHeader className="pr-12">
          <SheetTitle className="text-[28px] leading-tight font-semibold">Check report</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-8 px-4 pb-6">
          <RulesTable rows={rows} />
          <SynonymTable synonyms={synonyms} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
