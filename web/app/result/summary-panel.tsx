"use client";
/**
 * A summary panel that starts closed: a heading button with a count, and the
 * list under it when opened. It opens and closes at once, with no animation.
 */
import { ChevronDown } from "lucide-react";
import { useId } from "react";
import { cn } from "cn";

export function SummaryPanel({
  heading,
  count,
  preview = null,
  open,
  onOpenChange,
  emphasis = false,
  children,
}: {
  heading: string;
  /** For example "15 things to do". */
  count: string;
  /** One line shown under the count while closed, so the most useful item is visible without opening. */
  preview?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A 2px Ink Blue border, for "What you need to do". */
  emphasis?: boolean;
  children: React.ReactNode;
}) {
  const panelId = useId();
  return (
    <section
      className={cn(
        "rounded-2xl bg-card",
        emphasis ? "border-2 border-primary" : "border border-border",
      )}
    >
      <h2 className="text-[22px] leading-tight font-semibold">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => onOpenChange(!open)}
          className={cn(
            "flex min-h-12 w-full items-center gap-4 px-5 py-4 text-left sm:px-6 [@media(hover:hover)]:hover:bg-wash",
            open ? "rounded-t-[14px]" : "rounded-[14px]",
          )}
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span>{heading}</span>
            <span className="text-lg font-normal text-muted-foreground">
              <span className="sr-only">, </span>
              {count}
            </span>
            {!open && preview && (
              <span className="text-lg font-normal text-foreground [overflow-wrap:anywhere]">
                <span className="sr-only">, </span>
                {preview}
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-2 text-lg font-semibold text-link">
            <span className="sr-only">, </span>
            {open ? "Hide" : "Show"}
            <ChevronDown
              aria-hidden
              strokeWidth={2}
              absoluteStrokeWidth
              className={cn("size-6", open && "rotate-180")}
            />
          </span>
        </button>
      </h2>
      <div id={panelId} hidden={!open} className="border-t border-border px-5 py-4 sm:px-6">
        {children}
      </div>
    </section>
  );
}
