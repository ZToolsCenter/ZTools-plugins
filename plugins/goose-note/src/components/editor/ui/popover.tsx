import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "../utils/cn";

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverAnchor = PopoverPrimitive.Anchor;

type PopoverContentProps = React.ComponentPropsWithoutRef<
  typeof PopoverPrimitive.Content
> & {
  container?: React.ComponentPropsWithoutRef<
    typeof PopoverPrimitive.Portal
  >["container"];
  editorContext?: boolean;
};

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  PopoverContentProps
>(
  (
    {
      className,
      align = "center",
      sideOffset = 4,
      container,
      editorContext,
      children,
      ...props
    },
    ref,
  ) => (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
        className={cn(
          "z-[20000] outline-none data-[state=open]:animate-in data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          !editorContext &&
            "w-64 rounded-[10px] border border-border/80 bg-[hsl(var(--popover))] p-2 text-popover-foreground",
          !editorContext && className,
        )}
        {...props}
        style={{
          // 部分旧 WebView 无法渲染 Tailwind 的 box-shadow 变量链，投影走内联 style。
          boxShadow: editorContext
            ? undefined
            : "0 8px 22px rgba(15,23,42,0.1), 0 1px 3px rgba(15,23,42,0.06)",
          ...props.style,
        }}
      >
        {editorContext ? (
          <div
            className={cn(
              "goose-editor-context-ui w-64 rounded-[10px] border border-border/80 bg-[hsl(var(--popover))] p-2 text-popover-foreground",
              className,
            )}
            style={{
              boxShadow:
                "0 8px 22px rgba(15,23,42,0.1), 0 1px 3px rgba(15,23,42,0.06)",
            }}
          >
            {children}
          </div>
        ) : (
          children
        )}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  ),
);
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent };
