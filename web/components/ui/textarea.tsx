import * as React from "react"
import { cn } from "cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-[14px] border border-input bg-card px-4 py-3 text-lg leading-relaxed transition-[border-color,opacity] duration-150 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 read-only:opacity-60 aria-invalid:border-destructive dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
