import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "./button";

type FeatureToastAction = {
  label: string;
  onClick: () => void;
  onPointerDown?: (e: React.PointerEvent<HTMLButtonElement>) => void;
  variant?: ButtonProps["variant"];
  className?: string;
};

interface FeatureToastCardProps {
  icon: ReactNode;
  title: ReactNode;
  children: ReactNode;
  actions: FeatureToastAction[];
  className?: string;
}

export function FeatureToastCard({
  icon,
  title,
  children,
  actions,
  className,
}: FeatureToastCardProps) {
  return (
    <div className={cn("flex max-w-[360px] gap-3", className)}>
      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-primary/10 text-primary">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="pr-6 text-sm font-semibold text-foreground">{title}</div>
        <div className="mt-1 space-y-1 text-[13px] leading-5 text-muted-foreground">
          {children}
        </div>
        <div className="mt-3 flex items-center gap-2">
          {actions.map((action) => (
            <Button
              key={action.label}
              type="button"
              variant={action.variant}
              size="sm"
              className={cn("h-8 rounded-[10px] px-3 text-xs", action.className)}
              onClick={action.onClick}
              onPointerDown={action.onPointerDown}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
