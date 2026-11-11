/**
 * Pipeline stages while a letter converts. Each state has a static cue (a
 * tick, a spinner, a hollow dot, bold text and `aria-current`). Nothing else
 * moves: no shimmer and no icon animation, because moving text is harder to
 * read. The spinner stops under reduced motion.
 * Announcements stay on the input screen's `aria-live` line, not here.
 */
import { Check, LoaderCircle } from "lucide-react";
import type { StageRow, StageState } from "@/src/ui/convert-events";
import { cn } from "cn";

function StageIcon({ state }: { state: StageState }) {
  if (state === "done") return <Check strokeWidth={2.5} absoluteStrokeWidth className="size-6 text-foreground" />;
  if (state === "current")
    return <LoaderCircle strokeWidth={2} absoluteStrokeWidth className="size-6 text-primary motion-safe:animate-spin" />;
  return <span className="size-3 rounded-full border-2 border-input" />;
}

export function StageList({ rows }: { rows: StageRow[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {rows.map((row) => (
        <li
          key={row.id}
          aria-current={row.state === "current" ? "step" : undefined}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-lg"
        >
          <span aria-hidden className="grid size-7 shrink-0 place-items-center">
            <StageIcon state={row.state} />
          </span>
          <span
            className={cn(
              row.state === "pending" && "text-muted-foreground",
              row.state === "current" && "font-semibold",
            )}
          >
            {row.label}
            {row.state === "done" && <span className="sr-only"> (done)</span>}
          </span>
          {row.tag !== null && (
            <span className="rounded-full border border-border bg-tint px-3 py-0.5 text-lg tabular-nums">{row.tag}</span>
          )}
        </li>
      ))}
    </ol>
  );
}
