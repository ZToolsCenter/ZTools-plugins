import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const ChatChrome = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(function ChatChrome({ children, className, ...props }, ref) {
  return (
    <div ref={ref} className={cn("bui-chat", className)} {...props}>
      {children}
    </div>
  );
});
