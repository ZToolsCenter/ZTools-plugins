import * as React from "react";

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, ...props }, ref) => {
    const clamped = Math.min(100, Math.max(0, value));
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        className={cn(
          "relative h-2 w-full overflow-hidden rounded-full bg-secondary",
          className,
        )}
        {...props}
      >
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${clamped}%` }}
        />
      </div>
    );
  },
);
Progress.displayName = "Progress";

export { Progress };
