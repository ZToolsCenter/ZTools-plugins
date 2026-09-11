import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Chat panel chrome. Does not replace WorkspaceSidebar. */
export function ChatChrome({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("bui-chat", className)}>{children}</div>;
}
