import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SettingsSectionCardProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  contentClassName?: string;
  children?: ReactNode;
}

export function SettingsSectionCard({
  title,
  description,
  actions,
  className,
  contentClassName,
  children,
}: SettingsSectionCardProps) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-panel border border-border bg-surface p-4",
        className,
      )}
    >
      {title || description || actions ? (
        <header className="mb-3 flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {title ? (
              <h4 className="text-[13px] font-semibold tracking-tight text-fg">
                {title}
              </h4>
            ) : null}
            {description ? (
              <p className="mt-0.5 break-words text-[11.5px] leading-snug text-fg-faint">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </header>
      ) : null}

      {children ? (
        <div className={cn("min-w-0 space-y-2", contentClassName)}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
