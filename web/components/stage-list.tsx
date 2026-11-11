"use client";
/**
 * Pipeline stages while a letter converts. Each state has a static cue
 * (check icon, filled dot, hollow dot, and `aria-current`), so the shimmer on
 * the current stage and the icon cross-fade are never the only signal.
 * Announcements stay on the input screen's `aria-live` line, not here.
 */
import { Check } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { StageRow, StageState } from "@/src/ui/convert-events";
import { iconSwapVariants } from "@/src/ui/motion";
import { cn } from "cn";

function StageIcon({ state }: { state: StageState }) {
  if (state === "done") return <Check strokeWidth={2} absoluteStrokeWidth className="size-5 text-foreground" />;
  if (state === "current") return <span className="size-2.5 rounded-full bg-accent-blue" />;
  return <span className="size-2.5 rounded-full border-2 border-input" />;
}

export function StageList({ rows }: { rows: StageRow[] }) {
  const reduce = useReducedMotion() ?? false;
  const icon = iconSwapVariants(reduce);
  return (
    <ol className="flex flex-col gap-3">
      {rows.map((row) => (
        <li
          key={row.id}
          aria-current={row.state === "current" ? "step" : undefined}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-lg"
        >
          {/* Icons overlap in one grid cell, so the old and new cross-fade in place. */}
          <span aria-hidden className="grid size-6 shrink-0 place-items-center *:col-start-1 *:row-start-1">
            <AnimatePresence initial={false}>
              <motion.span
                key={row.state}
                className="grid place-items-center"
                initial="hidden"
                animate="visible"
                exit="hidden"
                variants={icon}
              >
                <StageIcon state={row.state} />
              </motion.span>
            </AnimatePresence>
          </span>
          <span
            className={cn(
              row.state === "pending" && "text-muted-foreground",
              row.state === "current" && "er-shimmer font-medium",
            )}
          >
            {row.label}
            {row.state === "done" && <span className="sr-only"> (done)</span>}
          </span>
          {row.tag !== null && <span className="label-mono rounded-full bg-tint px-2 py-0.5">{row.tag}</span>}
        </li>
      ))}
    </ol>
  );
}
