import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SelectionActions({
  children,
  className,
  busy,
}: {
  children: ReactNode;
  className?: string;
  busy?: boolean;
}) {
  return (
    <div
      className={cn("bui-select-actions", className)}
      data-busy={busy ? "true" : undefined}
    >
      {children}
    </div>
  );
}
