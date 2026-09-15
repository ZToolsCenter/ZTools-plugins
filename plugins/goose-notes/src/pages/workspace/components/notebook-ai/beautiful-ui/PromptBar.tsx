import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PromptBar({
  streaming,
  children,
  className,
}: {
  streaming?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bui-prompt-bar",
        streaming && "bui-prompt-bar--streaming",
        className,
      )}
      data-streaming={streaming ? "true" : undefined}
    >
      {streaming ? (
        <svg className="bui-prompt-bar-beam" aria-hidden focusable="false">
          <rect
            className="bui-prompt-bar-beam-glow"
            width="100%"
            height="100%"
            rx="15"
            ry="15"
            pathLength="1"
          />
          <rect
            className="bui-prompt-bar-beam-core"
            width="100%"
            height="100%"
            rx="15"
            ry="15"
            pathLength="1"
          />
        </svg>
      ) : null}
      {children}
    </div>
  );
}
