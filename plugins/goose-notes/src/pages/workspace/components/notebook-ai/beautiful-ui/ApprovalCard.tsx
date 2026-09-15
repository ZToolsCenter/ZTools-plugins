import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ApprovalCard({
  title,
  statusLabel,
  statusTone = "neutral",
  children,
  footer,
  className,
}: {
  title: string;
  statusLabel: string;
  statusTone?: "neutral" | "danger" | "success";
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("bui-root bui-approval notebook-ai-approval-plan", className)}
      aria-label="AI 笔记变更计划"
    >
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2.5">
        <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-medium",
            statusTone === "danger"
              ? "bg-[var(--goose-color-danger-subtle-bg)] text-[var(--goose-color-danger-focus)]"
              : statusTone === "success"
                ? "bg-[var(--goose-block-subtle-bg)] text-[var(--goose-color-success)]"
                : "bg-[var(--goose-block-subtle-bg)] text-foreground",
          )}
        >
          {statusLabel}
        </span>
      </div>
      {children}
      {footer ? (
        <div className="border-t border-border px-3 py-2.5">{footer}</div>
      ) : null}
    </section>
  );
}
