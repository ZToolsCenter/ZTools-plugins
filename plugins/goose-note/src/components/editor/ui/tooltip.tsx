import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "../utils/cn";
import {
  TOOLTIP_DELAY_MS,
  resolveTooltipDelayDuration,
} from "@/components/ui/tooltip-delay";

const TooltipProvider = ({
  delayDuration = TOOLTIP_DELAY_MS,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) => (
  <TooltipPrimitive.Provider
    delayDuration={resolveTooltipDelayDuration(delayDuration)}
    {...props}
  />
);

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

type TooltipContentProps = React.ComponentPropsWithoutRef<
  typeof TooltipPrimitive.Content
> & {
  /** 仅编辑器内的 Portal Tooltip 跟随 Cmd +/- 缩放。 */
  editorContext?: boolean;
};

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  TooltipContentProps
>(({ className, sideOffset = 4, editorContext = true, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-[21000] data-[state=closed]:hidden animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-tooltip-content-transform-origin]",
        !editorContext &&
          "select-none overflow-hidden whitespace-nowrap rounded-[14px] border border-border/80 bg-popover px-2.5 py-1.5 text-[12px] font-medium leading-none text-popover-foreground shadow-[0_8px_24px_rgba(15,23,42,0.12)] backdrop-blur-[1px] dark:border-white/20",
        !editorContext && className,
      )}
      {...props}
    >
      {editorContext ? (
        <div
          className={cn(
            "goose-editor-tooltip-surface select-none overflow-hidden whitespace-nowrap border border-border/80 bg-popover font-medium leading-none text-popover-foreground shadow-[0_8px_24px_rgba(15,23,42,0.12)] backdrop-blur-[1px] dark:border-white/20",
            className,
          )}
        >
          {props.children}
        </div>
      ) : (
        props.children
      )}
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
