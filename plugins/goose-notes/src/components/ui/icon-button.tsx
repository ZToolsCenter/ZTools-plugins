import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

const iconButtonVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      tone: {
        default: "text-foreground/90 hover:bg-[var(--goose-icon-chip-on-selected)] dark:hover:bg-[var(--goose-interactive-hover)]",
        muted:
          "text-muted-foreground/70 dark:text-muted-foreground/55 hover:text-foreground dark:hover:text-foreground/85 hover:bg-[var(--goose-icon-chip-on-selected)] dark:hover:bg-[var(--goose-interactive-hover)]",
        danger:
          "text-[var(--goose-color-danger)] hover:bg-[var(--goose-color-danger-subtle-bg)]",
        handle:
          "bg-muted/80 text-muted-foreground border border-border/50 backdrop-blur-[1px] cursor-grab hover:bg-primary/20 hover:text-foreground",
      },
      size: {
        xs: "h-6 w-6",
        sm: "h-7 w-7",
        icon: "h-8 w-8",
      },
      active: {
        true: "bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)]",
        false: "",
      },
    },
    defaultVariants: {
      tone: "default",
      size: "sm",
      active: false,
    },
  }
)

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {
  asChild?: boolean
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, tone, size, active, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"

    return (
      <Comp
        ref={ref}
        className={cn(iconButtonVariants({ tone, size, active, className }))}
        {...props}
      />
    )
  }
)

IconButton.displayName = "IconButton"

export { IconButton }
