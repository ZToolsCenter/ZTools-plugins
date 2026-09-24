import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type SettingsSectionTone = "default" | "danger";

interface SettingsSectionCardProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  tone?: SettingsSectionTone;
  className?: string;
  contentClassName?: string;
  children?: ReactNode;
}

export function SettingsSectionCard({
  title,
  description,
  actions,
  tone = "default",
  className,
  contentClassName,
  children,
}: SettingsSectionCardProps) {
  return (
    <section
      className={cn(
        "rounded-[14px] bg-[hsl(var(--goose-editor-bg))] p-5",
        tone === "danger" ? "bg-[hsl(var(--goose-editor-bg))]" : "",
        className,
      )}
    >
      {title || description || actions ? (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title ? (
              <h4 className="text-base font-semibold tracking-tight text-foreground">
                {title}
              </h4>
            ) : null}
            {description ? (
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </header>
      ) : null}

      {children ? (
        <div className={cn("space-y-4", contentClassName)}>{children}</div>
      ) : null}
    </section>
  );
}
