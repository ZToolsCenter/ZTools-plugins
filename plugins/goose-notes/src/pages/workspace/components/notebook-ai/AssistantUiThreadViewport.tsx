import type { ReactNode } from "react";
import { ThreadPrimitive } from "@assistant-ui/react";

interface AssistantUiThreadViewportProps {
  className?: string;
  children: ReactNode;
}
export function AssistantUiThreadViewport({
  className,
  children,
}: AssistantUiThreadViewportProps) {
  return (
    // min-h-0/min-w-0：flex 子项可在交叉轴收缩，宽表格在消息内滚而不是撑破整列
    <ThreadPrimitive.Root className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden">
      <ThreadPrimitive.Viewport
        autoScroll
        turnAnchor="bottom"
        scrollToBottomOnRunStart
        scrollToBottomOnInitialize
        scrollToBottomOnThreadSwitch
        className={className}
      >
        {children}
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}
