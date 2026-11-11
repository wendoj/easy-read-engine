/**
 * Devin's product window: a white window with a soft shadow ring, sitting on
 * a painted backdrop. Top and bottom bars hold the controls, as in Devin's
 * session composer. The transparent border keeps an edge in forced-colours
 * mode, where box-shadow is dropped.
 */
import { cn } from "cn";

/** Soft painted backdrop behind a product window (CSS only, decorative). */
export function Backdrop({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("er-backdrop p-3 sm:p-10 lg:p-14", className)}>{children}</div>;
}

export function Window({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "er-window overflow-hidden rounded-2xl border border-transparent bg-card shadow-window",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function WindowBar({
  children,
  position = "top",
  className,
}: {
  children: React.ReactNode;
  position?: "top" | "bottom";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3 sm:px-5",
        position === "top" ? "border-b border-border" : "border-t border-border",
        className,
      )}
    >
      {children}
    </div>
  );
}
