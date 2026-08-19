import { type Dispatch, type RefObject, type SetStateAction, type MutableRefObject } from "react";
import type { DragOverEvent } from "@dnd-kit/core";
import type { FlatTreeItem } from "../../tree-dnd";
import type { DropIntent, SidebarDragGuide } from "../useTreeDragHandlers";
import {
  getClientYFromActivator,
  getDragCenterY,
  resolveDropIntentKind,
  TOP_EDGE_DROP_ID,
  BOTTOM_EDGE_DROP_ID,
} from "./geometry";

const EDGE_DROP_PADDING = 10;
const DROP_INTENT_STABLE_PADDING = 8;
/** 悬停在折叠的父级行 nest 区上自动展开的延迟 */
const AUTO_EXPAND_DELAY_MS = 600;

interface UseDragOverParams {
  dragPointerYRef: MutableRefObject<number | null>;
  autoExpandTimerRef: MutableRefObject<number | null>;
  autoExpandTargetRef: MutableRefObject<string | null>;
  dropIntent: DropIntent | null;
  setDropIntent: Dispatch<SetStateAction<DropIntent | null>>;
  emitDragGuide: (guide: SidebarDragGuide | null) => void;
  flatItems: FlatTreeItem[];
  scrollRef: RefObject<HTMLDivElement | null>;
  visibleIndexMap: Map<string, number>;
  activeDescendantIds: Set<string>;
  allowNest: boolean;
  isLocalNotebook: boolean;
  rowHeight: number;
  itemHeight: number;
  setOpenPageIds: Dispatch<SetStateAction<Set<string>>>;
  clearAutoExpandTimer: () => void;
}

export function useDragOver({
  dragPointerYRef,
  autoExpandTimerRef,
  autoExpandTargetRef,
  dropIntent,
  setDropIntent,
  emitDragGuide,
  flatItems,
  scrollRef,
  visibleIndexMap,
  activeDescendantIds,
  allowNest,
  isLocalNotebook,
  rowHeight,
  itemHeight,
  setOpenPageIds,
  clearAutoExpandTimer,
}: UseDragOverParams) {
  const scheduleAutoExpand = (targetId: string | null) => {
    if (autoExpandTargetRef.current === targetId) return;
    clearAutoExpandTimer();
    autoExpandTargetRef.current = targetId;
    if (!targetId) return;
    autoExpandTimerRef.current = window.setTimeout(() => {
      autoExpandTimerRef.current = null;
      autoExpandTargetRef.current = null;
      setOpenPageIds((prev) => {
        if (prev.has(targetId)) return prev;
        const next = new Set(prev);
        next.add(targetId);
        return next;
      });
    }, AUTO_EXPAND_DELAY_MS);
  };

  const handleDragOver = ({ over, active, activatorEvent }: DragOverEvent) => {
    const translatedRect = active.rect.current.translated ?? active.rect.current.initial;
    const pointerY =
      dragPointerYRef.current ??
      getClientYFromActivator(activatorEvent) ??
      getDragCenterY(translatedRect, activatorEvent);

    if (!over) {
      scheduleAutoExpand(null);
      emitDragGuide({ direction: "left", mode: "sort" });
      if (flatItems.length > 0 && pointerY !== null) {
        const containerRect = scrollRef.current?.getBoundingClientRect();
        const firstItem = flatItems[0];
        const lastItem = flatItems[flatItems.length - 1];
        if (containerRect) {
          if (pointerY <= containerRect.top + EDGE_DROP_PADDING) {
            setDropIntent({ overId: firstItem.id, kind: "before" });
            return;
          }
          if (pointerY >= containerRect.bottom - EDGE_DROP_PADDING) {
            setDropIntent({ overId: lastItem.id, kind: "after" });
            return;
          }
        }
      }
      setDropIntent(null);
      return;
    }

    let overItemId = String(over.id);
    // 指针仍停留在当前意图行内时保持锚定，避免 collision 在行间跳变
    const stableAnchorId = dropIntent?.overId;
    if (
      pointerY !== null &&
      stableAnchorId &&
      overItemId !== TOP_EDGE_DROP_ID &&
      overItemId !== BOTTOM_EDGE_DROP_ID &&
      stableAnchorId !== overItemId &&
      stableAnchorId !== TOP_EDGE_DROP_ID &&
      stableAnchorId !== BOTTOM_EDGE_DROP_ID &&
      scrollRef.current
    ) {
      const currentVisibleIndex = visibleIndexMap.get(stableAnchorId);
      if (currentVisibleIndex !== undefined) {
        const containerRect = scrollRef.current.getBoundingClientRect();
        const currentTop =
          containerRect.top - scrollRef.current.scrollTop + currentVisibleIndex * rowHeight;
        const currentBottom = currentTop + itemHeight;
        if (
          pointerY >= currentTop + DROP_INTENT_STABLE_PADDING &&
          pointerY <= currentBottom - DROP_INTENT_STABLE_PADDING
        ) {
          overItemId = stableAnchorId;
        }
      }
    }

    if (overItemId === TOP_EDGE_DROP_ID) {
      scheduleAutoExpand(null);
      emitDragGuide({ direction: "left", mode: "sort" });
      const firstItem = flatItems[0];
      if (!firstItem) {
        setDropIntent(null);
        return;
      }
      setDropIntent({ overId: firstItem.id, kind: "before" });
      return;
    }

    if (overItemId === BOTTOM_EDGE_DROP_ID) {
      scheduleAutoExpand(null);
      emitDragGuide({ direction: "left", mode: "sort" });
      const lastItem = flatItems[flatItems.length - 1];
      if (!lastItem) {
        setDropIntent(null);
        return;
      }
      setDropIntent({ overId: lastItem.id, kind: "after" });
      return;
    }

    if (activeDescendantIds.has(overItemId)) {
      scheduleAutoExpand(null);
      emitDragGuide({ direction: "left", mode: "sort" });
      setDropIntent(null);
      return;
    }

    const overItem = flatItems.find((item) => item.id === overItemId);
    if (!overItem || overItemId === String(active.id)) {
      scheduleAutoExpand(null);
      emitDragGuide({ direction: "left", mode: "sort" });
      setDropIntent(null);
      return;
    }

    const canNest =
      allowNest &&
      !activeDescendantIds.has(overItem.id) &&
      (!isLocalNotebook || !!overItem.page.isFolder);

    let overRectForIntent: { top: number; height: number } = {
      top: over.rect.top,
      height: over.rect.height,
    };
    const overVisibleIndex = visibleIndexMap.get(overItemId);
    if (overVisibleIndex !== undefined && scrollRef.current) {
      const containerRect = scrollRef.current.getBoundingClientRect();
      overRectForIntent = {
        top:
          containerRect.top - scrollRef.current.scrollTop + overVisibleIndex * rowHeight,
        height: itemHeight,
      };
    }

    const previousKind =
      dropIntent?.overId === overItemId ? dropIntent.kind : null;
    const kind = resolveDropIntentKind({
      canNest,
      isOverOpenParent: overItem.isOpen && overItem.hasChildren,
      overRect: overRectForIntent,
      pointerY,
      previousKind,
    });

    // 悬停在折叠且有子项的目标 nest 区时，延迟自动展开，便于继续往内部拖
    if (kind === "nest" && overItem.hasChildren && !overItem.isOpen) {
      scheduleAutoExpand(overItemId);
    } else {
      scheduleAutoExpand(null);
    }

    emitDragGuide(
      kind === "nest"
        ? { direction: "right", mode: "nest-ready" }
        : { direction: "left", mode: "sort" }
    );

    if (dropIntent?.overId === overItemId && dropIntent.kind === kind) {
      return;
    }
    setDropIntent({ overId: overItemId, kind });
  };

  return { handleDragOver };
}
