import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 外壳基础控件：原生 input（避免 HeroUI/RAC 在 uTools 旧内核下受控输入失效）。
 * 业务契约：type/value/onChange(e)/placeholder/disabled/id/autoFocus/onKeyDown/autoComplete/ref…
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        data-slot="input"
        className={cn(
          "flex h-10 w-full rounded-[10px] border border-transparent bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
