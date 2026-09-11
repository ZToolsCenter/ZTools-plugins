import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline:
          "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-11 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Disable the click ripple effect (e.g. for asChild wrappers). */
  noRipple?: boolean;
}

interface Ripple {
  id: number;
  x: number;
  y: number;
  size: number;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, noRipple = false, onClick, children, ...props },
    ref
  ) => {
    const [ripples, setRipples] = React.useState<Ripple[]>([]);

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (!noRipple && !asChild) {
        const el = e.currentTarget;
        const rect = el.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const x = e.clientX - rect.left - size / 2;
        const y = e.clientY - rect.top - size / 2;
        const id = performance.now() + Math.random();
        setRipples((r) => [...r, { id, x, y, size }]);
        window.setTimeout(
          () => setRipples((r) => r.filter((rp) => rp.id !== id)),
          600
        );
      }
      onClick?.(e);
    };

    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        onClick={handleClick}
        className={cn(
          buttonVariants({ variant, size }),
          "relative overflow-hidden transition-transform duration-150 active:scale-[0.97] active:duration-75",
          className
        )}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            <span className="relative z-10 inline-flex items-center gap-2">
              {children}
            </span>
            <span className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[inherit]">
              {ripples.map((r) => (
                <span
                  key={r.id}
                  className="absolute rounded-full bg-white/40 animate-pop-in"
                  style={{
                    left: r.x,
                    top: r.y,
                    width: r.size,
                    height: r.size,
                  }}
                />
              ))}
            </span>
          </>
        )}
      </Comp>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
