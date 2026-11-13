"use client";
import { Info } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { ProblemIcon } from "@/components/status-icons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { statusFade } from "@/src/ui/motion";
import { wordLimitState } from "@/src/ui/word-limit";
import { cn } from "cn";

export const OUTSIDE_AI_NOTICE =
  "Your letter text is sent to an outside AI service, so don't upload letters with personal details.";

/**
 * The panel is the field's boundary. `er-panel-field` drops the focus ring
 * (globals.css): the blinking cursor shows where typing goes.
 */
export const PANEL_FIELD =
  "er-panel-field min-h-72 resize-y rounded-none border-0 bg-transparent px-4 py-4 text-lg leading-normal sm:px-6";

/** Right before the button that sends the letter out. No close button, by design. */
function OutsideAiNotice() {
  return (
    <Alert role="note" className="border-input bg-accent-tint">
      <Info aria-hidden strokeWidth={2} absoluteStrokeWidth />
      <AlertDescription className="text-lg leading-normal text-foreground">{OUTSIDE_AI_NOTICE}</AlertDescription>
    </Alert>
  );
}

export function SendBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-t border-border px-4 py-5 sm:px-6">
      <OutsideAiNotice />
      <div className="flex flex-wrap justify-end gap-3">{children}</div>
    </div>
  );
}

/** The word-limit message uses `role="status"`, so it isn't read out on every keystroke. */
export function ErrorAlert({ message, role = "alert" }: { message: string | null; role?: "alert" | "status" }) {
  const reduce = useReducedMotion() ?? false;
  if (!message) return null;
  return (
    <motion.div {...statusFade(reduce)}>
      <Alert variant="destructive" role={role}>
        <ProblemIcon />
        <AlertDescription className="text-lg text-destructive">{message}</AlertDescription>
      </Alert>
    </motion.div>
  );
}

export function WordCount({ text, id }: { text: string; id: string }) {
  const state = wordLimitState(text);
  return (
    <span
      id={id}
      className={cn(
        "inline-flex items-center gap-1.5 text-lg tabular-nums",
        state.overLimit ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {state.overLimit && <ProblemIcon className="size-5" />}
      {state.label}
    </span>
  );
}
