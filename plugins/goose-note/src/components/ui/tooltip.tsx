import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import {
  TOOLTIP_DELAY_MS,
  resolveTooltipDelayDuration,
} from "./tooltip-delay";

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

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-[21000] select-none overflow-hidden whitespace-nowrap rounded-[14px] border border-border/80 bg-popover px-2.5 py-1.5 text-[12px] font-medium leading-none text-popover-foreground shadow-[0_8px_24px_rgba(15,23,42,0.12)] backdrop-blur-[1px] data-[state=closed]:hidden animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-tooltip-content-transform-origin] dark:border-white/20",
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
