import { type CSSProperties } from "react";
import { createPortal } from "react-dom";
import * as LucideIcons from "lucide-react";
import { cn } from "@/components/editor/utils/cn";
import type { AiReferenceSuggestionItem } from "@/components/editor/ai/composer/referenceLookup";
import { useCenteredActiveItemScroll } from "@/components/editor/hooks/useCenteredActiveItemScroll";
import { EDITOR_FONT_SIZE_DEFAULT, useSettings } from "@/stores/useSettings";

interface ComposerSuggestionsListProps {
  items: AiReferenceSuggestionItem[];
  activeIndex: number;
  listKey?: string;
  anchorRect: DOMRect;
  onSelect: (item: AiReferenceSuggestionItem) => void;
  onMouseDownCapture?: () => void;
}

const POPOVER_MAX_HEIGHT = 280;
const POPOVER_EMPTY_HEIGHT = 40;
const POPOVER_MIN_WIDTH = 240;
const POPOVER_MAX_WIDTH = 340;
const VIEWPORT_PADDING = 8;
const GAP = 4;
/** 双行项（标题 + 路径）估算高度，需与下方 py/gap 保持同步 */
const ITEM_HEIGHT = 48;
const ITEM_GAP = 4;
const LIST_PADDING = 12;
const getMentionItemSelector = (index: number) =>
  `[data-mention-index="${index}"]`;

export function ComposerSuggestionsList({
  items,
  activeIndex,
  listKey,
  anchorRect,
  onSelect,
  onMouseDownCapture,
}: ComposerSuggestionsListProps) {
  const editorUiScale =
    useSettings((state) => state.editorFontSize) / EDITOR_FONT_SIZE_DEFAULT;
  // AI composer 固定在面板底部：优先向上展开，避免盖住模型选择 / 发送按钮。
  // 仅当上方空间明显不够、下方更充裕时才翻到下方。
  const estimatedHeight =
    items.length === 0
      ? POPOVER_EMPTY_HEIGHT
      : Math.min(
          POPOVER_MAX_HEIGHT,
          items.length * ITEM_HEIGHT +
            Math.max(0, items.length - 1) * ITEM_GAP +
            LIST_PADDING,
        );

  const spaceBelow =
    window.innerHeight - anchorRect.bottom - GAP - VIEWPORT_PADDING;
  const spaceAbove = anchorRect.top - GAP - VIEWPORT_PADDING;
  const canFitAbove = spaceAbove >= estimatedHeight;
  const canFitBelow = spaceBelow >= estimatedHeight;
  const placeAbove = canFitAbove
    ? true
    : !canFitBelow && spaceAbove > spaceBelow;

  const available =
    Math.max(0, placeAbove ? spaceAbove : spaceBelow) / editorUiScale;
  const maxHeight = Math.min(
    POPOVER_MAX_HEIGHT,
    Math.max(
      items.length === 0 ? POPOVER_EMPTY_HEIGHT : ITEM_HEIGHT + LIST_PADDING,
      available,
    ),
  );

  // 空 range / 异常 rect 时退回到视口安全区，避免 left/top 落到 0 把菜单甩到左上角
  const anchorLeft =
    Number.isFinite(anchorRect.left) &&
    (anchorRect.width > 0 || anchorRect.height > 0)
      ? anchorRect.left
      : VIEWPORT_PADDING;
  const maxLeft =
    window.innerWidth - POPOVER_MAX_WIDTH * editorUiScale - VIEWPORT_PADDING;

  const style: CSSProperties = {
    position: "fixed",
    left: Math.max(VIEWPORT_PADDING, Math.min(anchorLeft, maxLeft)),
    zIndex: 9999,
    ...(placeAbove
      ? { bottom: window.innerHeight - anchorRect.top + GAP * editorUiScale }
      : { top: anchorRect.bottom + GAP * editorUiScale }),
  };

  const listRef = useCenteredActiveItemScroll<HTMLUListElement>({
    activeIndex,
    itemCount: items.length,
    listKey,
    itemSelector: getMentionItemSelector,
  });

  const popover = (
    <div
      style={style}
      className="overflow-hidden"
      onMouseDownCapture={(e) => {
        e.preventDefault();
        onMouseDownCapture?.();
      }}
    >
      <div
        className="goose-editor-context-ui overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
        style={{
          minWidth: POPOVER_MIN_WIDTH,
          maxWidth: POPOVER_MAX_WIDTH,
          maxHeight,
        }}
      >
        {items.length === 0 ? (
          <div className="px-3 py-2.5 text-[13px] text-muted-foreground">
            未找到匹配笔记
          </div>
        ) : (
          <ul
            ref={listRef}
            className="flex flex-col gap-1 overflow-y-auto p-1.5"
            style={{ maxHeight }}
          >
            {items.map((item, index) => (
              <li key={item.pageId} data-mention-index={index}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left",
                    index === activeIndex
                      ? "bg-[var(--goose-interactive-selected)] text-[var(--goose-interactive-selected-fg)]"
                      : "hover:bg-[var(--goose-interactive-hover)] hover:text-[hsl(var(--foreground))]",
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelect(item);
                  }}
                >
                  {item.isFolder ? (
                    <LucideIcons.Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <LucideIcons.FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
                    <div className="truncate text-[13px] font-medium leading-snug text-foreground">
                      {item.title}
                    </div>
                    <div className="truncate text-[11px] leading-snug text-muted-foreground">
                      {item.description}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  return createPortal(popover, document.body);
}
