import * as React from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { useContextMenu } from "@/components/editor/state/contextMenu";

// 受控的 ContextMenu，自动管理全局状态以支持"切换页面隐藏菜单"等场景
interface ContextMenuProps extends Omit<
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Root>,
  "open"
> {
  children: React.ReactNode;
}

function ContextMenu({ children, onOpenChange, ...props }: ContextMenuProps) {
  const { openMenuId, open, close, generateId } = useContextMenu();
  const [menuId] = React.useState(() => generateId());

  // 组件卸载时如果是当前打开的菜单，则关闭
  React.useEffect(() => {
    return () => {
      if (useContextMenu.getState().openMenuId === menuId) {
        close();
      }
    };
  }, [menuId, close]);

  const isOpen = openMenuId === menuId;

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        open(menuId);
      } else {
        close();
      }
      onOpenChange?.(nextOpen);
    },
    [open, close, menuId, onOpenChange],
  );
  // Radix 实际支持 open prop 但类型定义中未声明，使用类型断言
  const rootProps = {
    open: isOpen,
    onOpenChange: handleOpenChange,
    ...props,
  } as React.ComponentProps<typeof ContextMenuPrimitive.Root>;

  return (
    <ContextMenuPrimitive.Root {...rootProps}>
      {children}
    </ContextMenuPrimitive.Root>
  );
}

const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

const ContextMenuGroup = ContextMenuPrimitive.Group;

const ContextMenuPortal = ContextMenuPrimitive.Portal;

const ContextMenuSub = ContextMenuPrimitive.Sub;

const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

/* uTools 旧内核渲染不出 Tailwind 的 box-shadow 变量链，菜单投影必须走内联 style */
const MENU_SHADOW =
  "0 14px 34px rgba(15,23,42,0.16), 0 2px 8px rgba(15,23,42,0.08)";

const ContextMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger> & {
    inset?: boolean;
  }
>(({ className, inset, children, ...props }, ref) => (
  <ContextMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center rounded-[10px] px-2 py-1.5 text-sm outline-none transition-colors focus:bg-[var(--goose-interactive-selected)] focus:text-foreground data-[highlighted]:bg-[var(--goose-interactive-selected)] data-[highlighted]:text-foreground data-[state=open]:bg-[var(--goose-interactive-selected)] data-[state=open]:text-foreground",
      inset && "pl-8",
      className,
    )}
    {...props}
  >
    {children}
    <LucideIcons.ChevronRight className="ml-auto h-4 w-4" />
  </ContextMenuPrimitive.SubTrigger>
));
ContextMenuSubTrigger.displayName = ContextMenuPrimitive.SubTrigger.displayName;

const ContextMenuSubContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent> & {
    editorContext?: boolean;
  }
>(({ className, editorContext, children, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.SubContent
      ref={ref}
      className={cn(
        "z-[20000] outline-none data-[state=open]:animate-in data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-context-menu-content-transform-origin]",
        !editorContext &&
          "min-w-[9.5rem] overflow-hidden rounded-[14px] border-0 bg-[hsl(var(--popover))] p-1.5 text-popover-foreground",
        !editorContext && className,
      )}
      {...props}
      style={
        editorContext ? props.style : { boxShadow: MENU_SHADOW, ...props.style }
      }
    >
      {editorContext ? (
        <div
          className={cn(
            "goose-editor-context-ui min-w-[9.5rem] overflow-hidden rounded-[14px] border-0 bg-[hsl(var(--popover))] p-1.5 text-popover-foreground",
            className,
          )}
          style={{ boxShadow: MENU_SHADOW }}
        >
          {children}
        </div>
      ) : (
        children
      )}
    </ContextMenuPrimitive.SubContent>
  </ContextMenuPrimitive.Portal>
));
ContextMenuSubContent.displayName = ContextMenuPrimitive.SubContent.displayName;

const ContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content> & {
    editorContext?: boolean;
  }
>(({ className, editorContext, children, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      className={cn(
        "z-[20000] outline-none data-[state=open]:animate-in data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        !editorContext &&
          "min-w-[9.5rem] overflow-hidden rounded-[14px] border-0 bg-[hsl(var(--popover))] p-1.5 text-popover-foreground",
        !editorContext && className,
      )}
      {...props}
      style={
        editorContext ? props.style : { boxShadow: MENU_SHADOW, ...props.style }
      }
    >
      {editorContext ? (
        <div
          className={cn(
            "goose-editor-context-ui min-w-[9.5rem] overflow-hidden rounded-[14px] border-0 bg-[hsl(var(--popover))] p-1.5 text-popover-foreground",
            className,
          )}
          style={{ boxShadow: MENU_SHADOW }}
        >
          {children}
        </div>
      ) : (
        children
      )}
    </ContextMenuPrimitive.Content>
  </ContextMenuPrimitive.Portal>
));
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName;

const ContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center gap-2 rounded-[10px] px-1.5 py-1.5 text-[13px] outline-none transition-colors focus:bg-[var(--goose-interactive-selected)] focus:text-foreground data-[highlighted]:bg-[var(--goose-interactive-selected)] data-[highlighted]:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      inset && "pl-8",
      className,
    )}
    {...props}
  />
));
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName;

const ContextMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <ContextMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-[var(--goose-interactive-selected)] focus:text-foreground data-[highlighted]:bg-[var(--goose-interactive-selected)] data-[highlighted]:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <ContextMenuPrimitive.ItemIndicator>
        <LucideIcons.Check className="h-4 w-4" />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </ContextMenuPrimitive.CheckboxItem>
));
ContextMenuCheckboxItem.displayName =
  ContextMenuPrimitive.CheckboxItem.displayName;

const ContextMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <ContextMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-[var(--goose-interactive-selected)] focus:text-foreground data-[highlighted]:bg-[var(--goose-interactive-selected)] data-[highlighted]:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <ContextMenuPrimitive.ItemIndicator>
        <LucideIcons.Circle className="h-2 w-2 fill-current" />
      </ContextMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </ContextMenuPrimitive.RadioItem>
));
ContextMenuRadioItem.displayName = ContextMenuPrimitive.RadioItem.displayName;

const ContextMenuLabel = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <ContextMenuPrimitive.Label
    ref={ref}
    className={cn(
      "px-2 py-1.5 text-[12px] font-semibold tracking-wide text-muted-foreground",
      inset && "pl-8",
      className,
    )}
    {...props}
  />
));
ContextMenuLabel.displayName = ContextMenuPrimitive.Label.displayName;

const ContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-border", className)}
    {...props}
  />
));
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName;

const ContextMenuShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
};
ContextMenuShortcut.displayName = "ContextMenuShortcut";

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
};
