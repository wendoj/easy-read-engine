/**
 * A plain white panel with a visible 3:1 border, so its edge shows without a
 * shadow and in Windows high contrast mode. Bars at the top or bottom hold
 * the controls.
 */
import { cn } from "cn";

export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("overflow-hidden rounded-2xl border border-border bg-card", className)}>{children}</div>;
}

export function PanelBar({
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
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-4 sm:px-6",
        position === "top" ? "border-b border-border" : "border-t border-border",
        className,
      )}
    >
      {children}
    </div>
  );
}
