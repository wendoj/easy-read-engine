"use client";
import { ArrowRight } from "lucide-react";
import { useCallback } from "react";
import { Panel, PanelBar } from "@/components/composer";
import { StageList } from "@/components/stage-list";
import { Steps } from "@/components/steps";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { progressLabel, progressValue, stageRows } from "@/src/ui/convert-events";
import { ErrorAlert, PANEL_FIELD, SendBar, WordCount } from "./panel-parts";
import type { InputFlow } from "./use-input-flow";

/** The text in this box when the user converts is the Original for every later step. */
export function ConfirmStep({
  flow,
  ids,
  accessNotice,
}: {
  flow: InputFlow;
  ids: { confirm: string; confirmCount: string };
  accessNotice: React.ReactNode;
}) {
  const { text, setText, limit, locked, progress, sawFix } = flow;
  const converting = flow.busy === "converting";
  // Focus lands on the step for keyboard and screen reader users. A ref
  // callback, because the heading mounts with the step.
  const focusOnMount = useCallback((el: HTMLHeadingElement | null) => el?.focus(), []);
  return (
    <section aria-labelledby={`${ids.confirm}-heading`} className="flex flex-col gap-6">
      <Steps current={2} />
      {accessNotice}
      <Panel>
        <PanelBar>
          <h2
            id={`${ids.confirm}-heading`}
            ref={focusOnMount}
            tabIndex={-1}
            className="text-[26px] leading-tight font-semibold outline-none"
          >
            Check your letter
          </h2>
          <WordCount text={text} id={ids.confirmCount} />
        </PanelBar>
        <label htmlFor={ids.confirm} className="block px-4 pt-4 text-lg sm:px-6">
          Change any words that are wrong.
        </label>
        <Textarea
          id={ids.confirm}
          value={text}
          onChange={(event) => setText(event.target.value)}
          readOnly={converting}
          aria-describedby={ids.confirmCount}
          aria-invalid={limit.overLimit || undefined}
          spellCheck
          className={PANEL_FIELD}
        />
        <SendBar>
          <Button type="button" variant="outline" onClick={flow.startAgain}>
            Start again
          </Button>
          <Button
            type="button"
            onClick={flow.convert}
            disabled={!limit.canConvert || converting || locked}
            aria-busy={converting || undefined}
          >
            {converting ? "Making it Easy Read" : "Make it Easy Read"}
            {!converting && <ArrowRight aria-hidden data-icon="inline-end" />}
          </Button>
        </SendBar>
      </Panel>

      <ErrorAlert message={limit.message} role="status" />
      <ErrorAlert message={flow.error} />

      {/* Always mounted, so screen readers announce each new stage. The panel below shows the same thing. */}
      <p aria-live="polite" role="status" className="sr-only">
        {converting ? (progress ? progressLabel(progress) : "Sending the letter") : ""}
      </p>
      {converting ? (
        <Panel className="flex flex-col gap-5 p-5 sm:p-6">
          <p aria-hidden className="text-xl font-semibold">
            {progress ? progressLabel(progress) : "Sending the letter"}
          </p>
          <Progress value={progress ? progressValue(progress) : 2} aria-label="Conversion progress" />
          <StageList rows={stageRows(progress, sawFix)} />
        </Panel>
      ) : null}
    </section>
  );
}
