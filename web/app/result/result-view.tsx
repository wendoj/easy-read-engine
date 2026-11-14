"use client";
/**
 * Original on the left (always shown), Easy Read on the right. The result is
 * never stored, so after a reload a sample loads again from `?sample=<id>`
 * and the user's own letter is gone.
 */
import { LoaderCircle } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { FlagIcon, ProblemIcon } from "@/components/status-icons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { isLocked } from "@/src/ui/access-lock";
import { loadSample } from "@/src/ui/api";
import { NOT_JUDGED_EXPORT_MESSAGE, blockSource, canExport, failedKeyFacts } from "@/src/ui/blocked-state";
import { useConversion } from "@/src/ui/conversion-context";
import { canUndo } from "@/src/ui/line-edit";
import { statusFade } from "@/src/ui/motion";
import { useReadAloud } from "@/src/ui/read-aloud";
import { resultLayout } from "@/src/ui/result-layout";
import { parseSampleId } from "@/src/ui/result-url";
import { buildToDoItems } from "@/src/ui/to-do-list";
import { useAccess } from "@/src/ui/use-access";
import { useConfirmUnload } from "@/src/ui/use-confirm-unload";
import { cn } from "cn";
import { BlockedState } from "./blocked-state";
import { FactLegend } from "./fact-legend";
import { MainPoints, mainPoints } from "./main-points";
import { SECTION_HEADING } from "./headings";
import { LineRow } from "./line-row";
import { NoResult } from "./no-result";
import { OriginalText } from "./original-text";
import { ResultFooter, SafetyNotice, SampleLabel } from "./result-notices";
import { RuleReport } from "./rule-report";
import { ToDoBox } from "./to-do-box";
import { useLineEditing } from "./use-line-editing";
import { useLineSelection } from "./use-line-selection";
import { usePdfExport } from "./use-pdf-export";

export function ResultView() {
  const sampleId = parseSampleId(useSearchParams().get("sample"));
  const { result, sample, setResult, startResult } = useConversion();
  const reduceMotion = useReducedMotion() ?? false;
  const readAloud = useReadAloud();
  const [reloadError, setReloadError] = useState<string | null>(null);
  // While access is unknown, Edit stays on: /api/check checks access again.
  const [access, setAccess] = useAccess();
  const layout = useMemo(() => (result ? resultLayout(result) : null), [result]);
  const selection = useLineSelection(layout);
  const pdf = usePdfExport(result);
  const editing = useLineEditing({
    result,
    setResult,
    stopReading: readAloud.stop,
    setAccess,
    onReplaced: pdf.clearExportError,
  });
  const { edit, onUndo } = editing;

  // Loading a public sample again makes no model call.
  const reloadSampleId = result === null ? sampleId : null;
  useEffect(() => {
    if (reloadSampleId === null) return;
    const controller = new AbortController();
    void loadSample(reloadSampleId, { signal: controller.signal }).then((outcome) => {
      if (outcome.ok) startResult(outcome.result, outcome.sample);
      else if (!outcome.aborted) setReloadError(outcome.message);
    });
    return () => controller.abort();
  }, [reloadSampleId, startResult]);

  useConfirmUnload(result !== null && sample === null);

  const undoAllowed = edit === null && canUndo(editing.history, result);
  const blocked = blockSource(result, editing.history);
  const toDoItems = useMemo(() => (result && layout ? buildToDoItems(result, layout.rows) : []), [result, layout]);
  const failedFacts = useMemo(() => (result ? failedKeyFacts(result) : []), [result]);
  const lineNumbers = useMemo(() => new Map((layout?.rows ?? []).map((r, i) => [r.id, i + 1])), [layout]);
  const points = useMemo(
    () => (result && layout && !layout.withheld ? mainPoints(result.keyFacts, result.lineFacts, lineNumbers) : []),
    [result, layout, lineNumbers],
  );
  // For "Next line to check": each line's next flagged line, by screen order.
  const nextToCheck = useMemo(() => {
    const out = new Map<string, { id: string; number: number } | null>();
    let next: { id: string; number: number } | null = null;
    const rows = layout?.rows ?? [];
    for (let i = rows.length - 1; i >= 0; i--) {
      out.set(rows[i].id, next);
      if (rows[i].flagged) next = { id: rows[i].id, number: i + 1 };
    }
    return { byLine: out, first: next };
  }, [layout]);
  const selectedSource = layout?.rows.find((r) => r.id === selection.selectedLineId)?.sourceText ?? null;
  const exportAllowed = canExport(result);

  if (!result || !layout) return <NoResult sampleId={sampleId} error={reloadError} />;

  const exportActions = (
    <div className="flex flex-wrap items-center gap-3">
      {/* When blocked, "Undo edit" is in the blocked state instead. */}
      {undoAllowed && blocked === null && (
        <Button type="button" variant="outline" onClick={onUndo}>
          Undo edit
        </Button>
      )}
      <Button
        type="button"
        disabled={!exportAllowed || pdf.exporting || edit !== null}
        onClick={() => void pdf.onExport()}
      >
        {pdf.exporting && <LoaderCircle aria-hidden data-icon="inline-start" className="motion-safe:animate-spin" />}
        {pdf.exporting ? "Making the PDF…" : "Download PDF"}
      </Button>
      {exportAllowed && edit === null && (
        <Link href="/print" className={buttonVariants({ variant: "outline" })}>
          Print
        </Link>
      )}
    </div>
  );

  // Nothing moves on load. Only a status that appears later fades in.
  // Meaning first: what to do, the dates and amounts, then the checks, then the two columns.
  return (
    <div className="flex flex-col gap-6">
      <SafetyNotice text={result.notice} />
      {/* Both start closed, side by side on wide screens, so the Easy Read lines stay close. */}
      {!layout.withheld && (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <ToDoBox
            items={toDoItems}
            styles={layout.factStyles}
            notice={result.notice}
            readAloud={readAloud}
            lineNumbers={lineNumbers}
            onGoToLine={selection.onGoToLine}
          />
          <MainPoints points={points} styles={layout.factStyles} onGoToLine={selection.onGoToLine} />
        </div>
      )}
      <RuleReport
        input={result}
        synonyms={result.actionSynonyms}
        onGoToLine={selection.onGoToLine}
        firstToCheck={nextToCheck.first}
        recording={sample !== null ? <SampleLabel sample={sample} /> : undefined}
      />
      {/* No export while P10 (no advice) hasn't run. Not dismissable. */}
      {blocked === null && !result.judgeAvailable && (
        <Alert role="status" className="border-input">
          <FlagIcon />
          <AlertDescription className="text-lg text-foreground">{NOT_JUDGED_EXPORT_MESSAGE}</AlertDescription>
        </Alert>
      )}
      {pdf.exportError !== null && (
        <motion.div {...statusFade(reduceMotion)}>
          <Alert variant="destructive" role="alert">
            <ProblemIcon />
            <AlertDescription className="text-lg text-destructive">{pdf.exportError}</AlertDescription>
          </Alert>
        </motion.div>
      )}
      <FactLegend keyFacts={result.keyFacts} />
      {/* Narrow screens stack the columns, Original first. */}
      <a
        href="#easy-read-heading"
        className={buttonVariants({
          variant: "outline",
          className: "w-fit lg:hidden",
        })}
      >
        Go to the Easy Read version
      </a>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section aria-labelledby="original-heading" className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-6">
          <h2 id="original-heading" className={SECTION_HEADING}>
            Original
          </h2>
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <OriginalText
              segments={layout.segments}
              styles={layout.factStyles}
              selectedSentenceId={selection.selectedSentenceId}
              register={selection.register}
              containerRef={selection.originalRef}
            />
          </div>
        </section>
        <section aria-labelledby="easy-read-heading" className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 id="easy-read-heading" tabIndex={-1} className={cn(SECTION_HEADING, "scroll-mt-6")}>
              Easy Read
            </h2>
            {!layout.withheld && exportActions}
          </div>
          {/* A block from the conversion shows at once; one from an edit fades in. */}
          {layout.withheld ? (
            <motion.div key="blocked" {...statusFade(reduceMotion || blocked !== "edit")}>
              <BlockedState
                source={blocked ?? "conversion"}
                failedFacts={failedFacts}
                styles={layout.factStyles}
                onUndo={onUndo}
              />
            </motion.div>
          ) : (
            <>
            <p className="text-lg leading-normal">Press a line number to listen to the line, see it in the letter, or change it.</p>
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {layout.rows.map((row, index) => (
                <LineRow
                  key={row.id}
                  index={index}
                  readAloud={readAloud}
                  row={row}
                  styles={layout.factStyles}
                  selected={row.id === selection.selectedLineId}
                  onSelect={selection.onSelect}
                  edit={edit?.lineId === row.id ? edit : null}
                  canEdit={!isLocked(access)}
                  editDisabled={edit !== null}
                  onEdit={editing.onEdit}
                  onDraft={editing.onDraft}
                  onSave={() => void editing.onSave()}
                  onCancel={editing.onCancel}
                  nextToCheck={nextToCheck.byLine.get(row.id) ?? null}
                  onGoToLine={selection.onGoToLine}
                />
              ))}
            </ul>
            </>
          )}
          {!layout.withheld && (
            <section aria-label="End of the Easy Read version" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 sm:p-6">
              <p className="text-xl leading-normal font-semibold">This is the end of the Easy Read version.</p>
              <p className="text-lg leading-normal">{result.notice}</p>
              {exportActions}
            </section>
          )}
        </section>
      </div>
      {/* Says which sentence of the Original a selected line came from, for screen readers. */}
      <p aria-live="polite" className="sr-only">
        {selectedSource !== null ? `From the letter: ${selectedSource}` : ""}
      </p>
      <ResultFooter />
    </div>
  );
}
