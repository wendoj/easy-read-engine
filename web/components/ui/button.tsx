import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-full border bg-clip-padding text-lg font-semibold whitespace-nowrap transition-[color,background-color,border-color,opacity,scale] duration-150 ease-out outline-none select-none [-webkit-tap-highlight-color:transparent] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-[#0f3780]",
        outline:
          "border-input bg-card text-foreground hover:bg-wash aria-expanded:bg-wash",
        tint: "border-border bg-tint hover:bg-tint-strong aria-expanded:bg-tint-strong",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost: "border-transparent hover:bg-tint aria-expanded:bg-tint",
        destructive:
          "border-destructive/30 bg-red-50 text-destructive hover:bg-red-100",
        link: "border-transparent text-link underline underline-offset-4 hover:decoration-2",
      },
      size: {
        default:
          "h-12 gap-2 px-6 has-data-[icon=inline-end]:pr-[22px] has-data-[icon=inline-start]:pl-[22px] [&_svg:not([class*='size-'])]:size-5",
        xs: "h-9 gap-1 px-3.5 text-[15px] has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-12 gap-1.5 px-5 has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        lg: "h-12 gap-2 px-6 has-data-[icon=inline-end]:pr-[22px] has-data-[icon=inline-start]:pl-[22px]",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
      /** Press feedback. Set `press={false}` where the scale would distract. */
      press: {
        true: "motion-safe:not-disabled:active:scale-[0.96]",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      press: true,
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  press = true,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, press, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
