/**
 * Where you are: Your letter → Check it → Easy Read. Shown on every screen
 * so readers don't lose their place. Each state has a number or a tick and a
 * word, so colour is never the only signal. Static: it never animates.
 */
import { Check } from "lucide-react";
import { cn } from "cn";

const STEPS = ["Your letter", "Check it", "Easy Read"] as const;

export function Steps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <nav aria-label="Steps">
      <ol className="flex flex-wrap items-center gap-x-5 gap-y-3 text-lg sm:gap-x-3">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const done = n < current;
          const here = n === current;
          return (
            <li key={label} className="flex items-center gap-3" aria-current={here ? "step" : undefined}>
              {i > 0 && <span aria-hidden className="hidden h-0.5 w-10 bg-border sm:block" />}
              <span
                aria-hidden
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-full border-2 text-lg font-semibold tabular-nums",
                  here && "border-primary bg-primary text-primary-foreground",
                  done && "border-input bg-tint-strong text-foreground",
                  !here && !done && "border-input bg-card text-foreground",
                )}
              >
                {done ? <Check strokeWidth={2.5} absoluteStrokeWidth className="size-5" /> : n}
              </span>
              <span className={cn(here ? "font-semibold text-foreground" : "text-muted-foreground")}>
                <span className="sr-only">Step {n}: </span>
                {label}
                {done && <span className="sr-only"> (done)</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
