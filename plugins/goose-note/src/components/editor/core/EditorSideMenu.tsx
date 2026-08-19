import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  useBlockNoteEditor,
  useExtension,
  useExtensionState,
} from "@blocknote/react";
import { SideMenuExtension } from "@blocknote/core/extensions";
import { Plus, GripVertical } from "lucide-react";
import { cn } from "@/components/editor/utils/cn";
import { useEditorSettings } from "@/components/editor/platform/hostContext";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/editor/ui/tooltip";

const isMac = /Mac/i.test(navigator.platform);
const altKeyLabel = isMac ? "⌥" : "Alt";

/** 把手与正文左缘的间距（px） */
const SIDE_MENU_CONTENT_GAP = 6;
const SIDEBAR_INTERACTION_SELECTOR = ".workspace-sidebar-pane, .rct-main-tree";
const SIDEBAR_HOVER_SELECTOR =
  ".workspace-sidebar-pane:hover, .rct-main-tree:hover";

export function EditorSideMenu() {
  const editor = useBlockNoteEditor<any, any, any>();
  const sideMenu = useExtension(SideMenuExtension);
  const [addTipOpen, setAddTipOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [sidebarInteracting, setSidebarInteracting] = useState(false);
  const { sidebarCollapsed = false } = useEditorSettings();

  const state = useExtensionState(SideMenuExtension, {
    selector: (s) =>
      s !== undefined
        ? {
            show: s.show,
            block: s.block,
            referencePos: s.referencePos,
          }
        : undefined,
  });

  const block = state?.block;
  // 折叠标题的折叠箭头悬挂在内容左缘外侧，与 side menu(+/拖拽把手)同列重叠
  // （留白消不掉，因二者同锚内容左缘、向同侧展开）。折叠标题整块不显示 side menu，
  // 加块/拖拽改走其它入口。toggleListItem 箭头是行内 marker、不重叠，不受影响。
  const headingProps = (
    block as { props?: { isToggleable?: boolean; n?: boolean } }
  )?.props;
  const isToggleableHeading =
    block?.type === "heading" &&
    Boolean(headingProps?.isToggleable ?? headingProps?.n);

  useEffect(() => {
    const updateSidebarInteracting = (
      target: EventTarget | null = document.activeElement,
    ) => {
      const element = target instanceof Element ? target : null;
      const activeElement = document.activeElement;
      const next =
        Boolean(element?.closest(SIDEBAR_INTERACTION_SELECTOR)) ||
        Boolean(activeElement?.closest?.(SIDEBAR_INTERACTION_SELECTOR)) ||
        Boolean(document.querySelector(SIDEBAR_HOVER_SELECTOR));
      setSidebarInteracting(next);
    };

    const handlePointerMove = (event: PointerEvent) =>
      updateSidebarInteracting(event.target);
    const handleFocusChange = (event: FocusEvent) =>
      updateSidebarInteracting(event.target);

    document.addEventListener("pointermove", handlePointerMove, true);
    document.addEventListener("focusin", handleFocusChange, true);
    document.addEventListener("focusout", handleFocusChange, true);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove, true);
      document.removeEventListener("focusin", handleFocusChange, true);
      document.removeEventListener("focusout", handleFocusChange, true);
    };
  }, []);

  // 先判定是否应显示，再更新位置/挂载 DOM，避免折叠标题上把手闪一下
  const shouldShow =
    Boolean(state?.show && state.referencePos && block) &&
    !isToggleableHeading &&
    !sidebarCollapsed &&
    !sidebarInteracting;

  const handleAdd = useCallback(
    (e: React.MouseEvent) => {
      setAddTipOpen(false);
      if (!block) return;
      const placement: "before" | "after" =
        e.altKey || e.ctrlKey || e.metaKey ? "before" : "after";
      const content = block.content;
      const isEmpty =
        content !== undefined && Array.isArray(content) && content.length === 0;
      if (isEmpty && placement === "after") {
        editor.setTextCursorPosition(block);
      } else {
        const [inserted] = editor.insertBlocks(
          [{ type: "paragraph" }],
          block,
          placement,
        );
        editor.setTextCursorPosition(inserted);
      }
      editor.focus();
    },
    [block, editor],
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      if (!block || !sideMenu) return;
      setAddTipOpen(false);
      setIsDragging(true);
      sideMenu.blockDragStart(
        { dataTransfer: e.dataTransfer, clientY: e.clientY },
        block,
      );
    },
    [block, sideMenu],
  );

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    sideMenu?.blockDragEnd?.();
  }, [sideMenu]);

  const referencePos = state?.referencePos;
  if (!shouldShow || !referencePos || !block) {
    return null;
  }

  // BlockNote 为 heading 设置了 padding-top:18px，底部仅 3px，
  // 导致几何中心比文字视觉中心偏高 (18-3)/2 = 7.5px，需补偿。
  const headingOffset = block.type === "heading" ? 7.5 : 0;
  const top = referencePos.top + referencePos.height / 2 + headingOffset;
  // 锚在内容左缘，再向左平移自身 100% 宽度，避免硬编码宽度不足时压住 placeholder。
  const anchorLeft = Math.max(
    SIDE_MENU_CONTENT_GAP + 4,
    referencePos.left - SIDE_MENU_CONTENT_GAP,
  );
  const portalTarget = editor.portalElement ?? document.body;
  return createPortal(
    <div
      className={cn(
        "bn-side-menu fixed z-[70]",
        "transition-[opacity,transform] duration-150 ease-out",
        "[body[data-scroll-locked]_&]:!opacity-0 [body[data-scroll-locked]_&]:!pointer-events-none",
      )}
      style={{
        top,
        left: anchorLeft,
        opacity: 1,
        // 缩放在内层用 --editor-scale 写真实尺寸，外壳只做定位平移。
        transform: "translate(-100%, -50%)",
        transformOrigin: "right center",
        pointerEvents: "auto",
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="goose-editor-inline-context-ui flex items-center gap-0.5 rounded-[10px] border border-border/50 bg-popover p-[3px] pl-1 pr-1 shadow-[0_1px_2px_hsl(var(--foreground)/0.05),0_8px_22px_hsl(var(--foreground)/0.06)] dark:border-white/12 dark:shadow-[0_8px_22px_rgba(0,0,0,0.35)]">
        <TooltipProvider delayDuration={600} disableHoverableContent>
          <Tooltip
            open={addTipOpen && shouldShow && !isDragging}
            onOpenChange={setAddTipOpen}
          >
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleAdd}
                className={cn(
                  "flex h-6 w-[22px] items-center justify-center rounded-[7px] text-muted-foreground/55",
                  "transition-colors hover:bg-[var(--goose-icon-chip-on-selected)] hover:text-foreground",
                )}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent editorContext side="bottom" align="start">
              <div className="flex flex-col gap-1 whitespace-nowrap">
                <span>
                  <span className="text-[hsl(var(--foreground))]">点击</span>{" "}
                  在下方添加块
                </span>
                <span>
                  <span className="text-[hsl(var(--foreground))]">
                    {altKeyLabel} 点击
                  </span>{" "}
                  在上方添加块
                </span>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <button
          type="button"
          draggable
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          className={cn(
            "relative flex h-6 w-[22px] cursor-grab items-center justify-center rounded-[7px] text-muted-foreground/45",
            "before:absolute before:-left-0.5 before:top-1 before:bottom-1 before:w-px before:bg-border/55 before:content-['']",
            "transition-colors hover:bg-[var(--goose-icon-chip-on-selected)] hover:text-foreground active:cursor-grabbing",
          )}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>,
    portalTarget,
  );
}
