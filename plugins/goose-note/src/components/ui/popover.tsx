
import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

const Popover = PopoverPrimitive.Root

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverAnchor = PopoverPrimitive.Anchor

type PopoverContentProps = React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & {
  container?: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Portal>["container"]
}

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  PopoverContentProps
>(({ className, align = "center", sideOffset = 4, container, ...props }, ref) => (
  <PopoverPrimitive.Portal container={container}>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={6}
      className={cn(
        "z-[20000] w-64 rounded-[10px] border border-border/80 bg-[hsl(var(--popover))] p-2 text-popover-foreground outline-none data-[state=open]:animate-in data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
      style={{
        // uTools 旧内核渲染不出 Tailwind 的 box-shadow 变量链，投影走内联 style
        boxShadow:
          "0 8px 22px rgba(15,23,42,0.1), 0 1px 3px rgba(15,23,42,0.06)",
        ...props.style,
      }}
    />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent }
