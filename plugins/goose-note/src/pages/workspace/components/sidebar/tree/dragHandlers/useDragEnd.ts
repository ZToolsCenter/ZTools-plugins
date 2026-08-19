import { type Dispatch, type RefObject, type SetStateAction, type MutableRefObject } from "react";
import type { DragEndEvent } from "@dnd-kit/core";
import type { Page } from "@/types";
import { isDescendant, type FlatTreeItem } from "../../tree-dnd";
import type { DropIntent, SidebarDragGuide } from "../useTreeDragHandlers";

const EDGE_DROP_PADDING = 10;

interface UseDragEndParams {
  resetTitleReveal: () => void;
  clearAutoExpandTimer: () => void;
  stopPointerTracking: () => void;
  emitDragGuide: (guide: SidebarDragGuide | null) => void;
  dropIntent: DropIntent | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  flatItems: FlatTreeItem[];
  setActiveId: Dispatch<SetStateAction<string | null>>;
  setDropIntent: Dispatch<SetStateAction<DropIntent | null>>;
  dragPointerYRef: MutableRefObject<number | null>;
  dragStartPointerYRef: MutableRefObject<number | null>;
  activeDescendantIds: Set<string>;
  pages: Record<string, Page>;
  isLocalNotebook: boolean;
  getSiblingPages: (parentId: string | undefined) => Page[];
  onReorder?: (ids: string[], parentId: string | undefined) => void;
  reorderPages: (ids: string[], parentId?: string) => void;
  setOpenPageIds: Dispatch<SetStateAction<Set<string>>>;
}

export function useDragEnd({
  resetTitleReveal,
  clearAutoExpandTimer,
  stopPointerTracking,
  emitDragGuide,
  dropIntent,
  scrollRef,
  flatItems,
  setActiveId,
  setDropIntent,
  dragPointerYRef,
  dragStartPointerYRef,
  activeDescendantIds,
  pages,
  isLocalNotebook,
  getSiblingPages,
  onReorder,
  reorderPages,
  setOpenPageIds,
}: UseDragEndParams) {
  const handleDragEnd = ({ active }: DragEndEvent) => {
    resetTitleReveal();
    clearAutoExpandTimer();
    stopPointerTracking();
    emitDragGuide(null);

    const activeNodeId = String(active.id);
    const fallbackIntent = (() => {
      if (dropIntent) return dropIntent;
      if (flatItems.length === 0) return null;
      const pointerY = dragPointerYRef.current;
      const containerRect = scrollRef.current?.getBoundingClientRect();
      if (pointerY === null || pointerY === undefined || !containerRect) {
        return null;
      }

      const firstItem = flatItems[0];
      const lastItem = flatItems[flatItems.length - 1];
      if (pointerY <= containerRect.top + EDGE_DROP_PADDING) {
        return { overId: firstItem.id, kind: "before" as const };
      }
      if (pointerY >= containerRect.bottom - EDGE_DROP_PADDING) {
        return { overId: lastItem.id, kind: "after" as const };
      }
      return null;
    })();
    const finalIntent = dropIntent ?? fallbackIntent;

    setActiveId(null);
    setDropIntent(null);
    dragPointerYRef.current = null;
    dragStartPointerYRef.current = null;

    if (!finalIntent) return;
    const overNodeId = finalIntent.overId;
    if (activeDescendantIds.has(overNodeId)) return;

    const activeItem = flatItems.find((item) => item.id === activeNodeId);
    const overItem = flatItems.find((item) => item.id === overNodeId);
    const activePage = pages[activeNodeId];
    if (!activeItem || !overItem || !activePage) return;

    let nextParentId: string | undefined;
    let nextOrderIds: string[] | null;

    if (finalIntent.kind === "nest") {
      const canNestIntoOver =
        overNodeId !== activeNodeId &&
        !isDescendant(activeNodeId, overNodeId, pages) &&
        (!isLocalNotebook || !!overItem.page.isFolder);
      if (!canNestIntoOver) return;

      nextParentId = overNodeId;
      const targetChildren = getSiblingPages(nextParentId)
        .filter((page) => page.id !== activeNodeId);
      nextOrderIds = [...targetChildren, activePage].map((page) => page.id);
    } else {
      nextParentId = overItem.parentId;
      const siblings = getSiblingPages(nextParentId)
        .filter((page) => page.id !== activeNodeId);
      const overSiblingIndex = siblings.findIndex((page) => page.id === overNodeId);
      if (overSiblingIndex < 0) return;

      const insertIndex =
        finalIntent.kind === "after" ? overSiblingIndex + 1 : overSiblingIndex;
      const reordered = [...siblings];
      reordered.splice(insertIndex, 0, activePage);
      nextOrderIds = reordered.map((page) => page.id);
    }

    if (isDescendant(activeNodeId, nextParentId, pages)) {
      return;
    }
    if (isLocalNotebook && nextParentId && !pages[nextParentId]?.isFolder) {
      return;
    }
    if (!nextOrderIds) return;
    const nextIds = nextOrderIds;

    const currentOrder = getSiblingPages(nextParentId).map((page) => page.id);
    if (
      nextParentId === activeItem.parentId &&
      currentOrder.length === nextIds.length &&
      currentOrder.every((id, index) => id === nextIds[index])
    ) {
      return;
    }

    if (onReorder) {
      onReorder(nextIds, nextParentId);
    } else {
      reorderPages(nextIds, nextParentId);
    }

    if (nextParentId) {
      setOpenPageIds((prev) => {
        if (prev.has(nextParentId)) return prev;
        const next = new Set(prev);
        next.add(nextParentId);
        return next;
      });
    }

    if (activeItem.parentId && activeItem.parentId !== nextParentId) {
      const remaining = getSiblingPages(activeItem.parentId).filter(
        (page) => page.id !== activeNodeId,
      );

      if (remaining.length === 0) {
        setOpenPageIds((prev) => {
          if (!prev.has(activeItem.parentId!)) return prev;
          const next = new Set(prev);
          next.delete(activeItem.parentId!);
          return next;
        });
      }
    }
  };

  return { handleDragEnd };
}
