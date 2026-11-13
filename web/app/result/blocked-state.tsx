"use client";
import { useEffect, useRef } from "react";
import { ProblemIcon } from "@/components/status-icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  BLOCKED_HEADING,
  BLOCKED_MESSAGES,
  type BlockSource,
  FAILED_FACTS_HEADING,
  type FailedFact,
  NO_FAILED_FACTS_MESSAGE,
} from "@/src/ui/blocked-state";
import { type FactStyle, factClassName } from "@/src/ui/key-fact-highlight";
import { StartAgainLink } from "./start-again-link";

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** No lines: the failed key facts with their Original values, and one way forward. */
export function BlockedState({
  source,
  failedFacts,
  styles,
  onUndo,
}: {
  source: BlockSource;
  failedFacts: FailedFact[];
  styles: ReadonlyMap<string, FactStyle>;
  onUndo: () => void;
}) {
  const undoRef = useRef<HTMLButtonElement>(null);
  // After a blocked edit the editor is gone, so put focus on the way back.
  useEffect(() => {
    if (source === "edit") undoRef.current?.focus();
  }, [source]);
  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <Alert variant="destructive" role="alert" className="border-2 border-destructive">
        <ProblemIcon strong className="translate-y-1!" />
        <AlertTitle className="text-xl font-semibold">{BLOCKED_HEADING}</AlertTitle>
        <AlertDescription className="text-lg text-destructive">{BLOCKED_MESSAGES[source]}</AlertDescription>
      </Alert>
      <section aria-labelledby="failed-facts-heading" className="flex flex-col gap-3">
        <h3 id="failed-facts-heading" className="text-[22px] leading-tight font-semibold">
          {FAILED_FACTS_HEADING}
        </h3>
        {failedFacts.length === 0 ? (
          <p className="text-lg">{NO_FAILED_FACTS_MESSAGE}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {failedFacts.map((fact) => {
              const style = styles.get(fact.id);
              return (
                <li key={fact.id} className="text-lg leading-relaxed">
                  <span className="font-semibold">{capitalise(fact.typeLabel)}: </span>
                  <span className={style ? factClassName(style) : undefined}>{fact.value}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {source === "edit" ? (
        <Button ref={undoRef} type="button" className="w-fit" onClick={onUndo}>
          Undo edit
        </Button>
      ) : (
        <StartAgainLink />
      )}
    </div>
  );
}
