/**
 * Static icons for problem states, so colour and motion are never the only
 * signal. One library (Lucide), `currentColor`, and a rendered stroke that
 * matches the text beside it: 1.5px next to regular text, 2px next to
 * medium or semibold text.
 */
import { CircleAlert, TriangleAlert } from "lucide-react";
import { cn } from "cn";

/** For a destructive `Alert`: an error, or the blocked state. */
export function ProblemIcon({ strong = false, className }: { strong?: boolean; className?: string }) {
  return (
    <CircleAlert
      aria-hidden
      strokeWidth={strong ? 2 : 1.5}
      absoluteStrokeWidth
      className={cn("size-5", className)}
    />
  );
}

/** For a flagged line's `Badge` (medium text). */
export function FlagIcon({ className }: { className?: string }) {
  return <TriangleAlert aria-hidden strokeWidth={2} absoluteStrokeWidth className={cn("size-3.5", className)} />;
}
