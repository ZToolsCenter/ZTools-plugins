import {
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { Page } from "@/types";
import { type FlatTreeItem } from "../tree-dnd";
import {
  getDragCenterY,
  getClientYFromActivator,
  TOP_EDGE_DROP_ID,
  BOTTOM_EDGE_DROP_ID,
} from "./dragHandlers/geometry";

export { TOP_EDGE_DROP_ID, BOTTOM_EDGE_DROP_ID };
import { useDragOver } from "./dragHandlers/useDragOver";
import { useDragEnd } from "./dragHandlers/useDragEnd";

export type DropIntentKind = "before" | "after" | "nest";
export type DragGuideDirection = "left" | "right";
export type DragGuideMode = "sort" | "nest-ready";

export interface DropIntent {
  overId: string;
  kind: DropIntentKind;
}

export interface SidebarDragGuide {
  direction: DragGuideDirection;
  mode: DragGuideMode;
}

interface UseTreeDragHandlersParams {
  activeDescendantIds: Set<string>;
  allowNest: boolean;
  dropIntent: DropIntent | null;
  emitDragGuide: (guide: SidebarDragGuide | null) => void;
  flatItems: FlatTreeItem[];
  getSiblingPages: (parentId: string | undefined) => Page[];
  isLocalNotebook: boolean;
  itemHeight: number;
  onReorder?: (ids: string[], parentId: string | undefined) => void;
  pages: Record<string, Page>;
  reorderPages: (ids: string[], parentId?: string) => void;
  resetTitleReveal: () => void;
  rowHeight: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  setActiveId: Dispatch<SetStateAction<string | null>>;
  setDropIntent: Dispatch<SetStateAction<DropIntent | null>>;
  setOpenPageIds: Dispatch<SetStateAction<Set<string>>>;
  visibleIndexMap: Map<string, number>;
}

export function useTreeDragHandlers({
  activeDescendantIds,
  allowNest,
  dropIntent,
  emitDragGuide,
  flatItems,
  getSiblingPages,
  isLocalNotebook,
  itemHeight,
  onReorder,
  pages,
  reorderPages,
  resetTitleReveal,
  rowHeight,
  scrollRef,
  setActiveId,
  setDropIntent,
  setOpenPageIds,
  visibleIndexMap,
}: UseTreeDragHandlersParams) {
  const autoExpandTimerRef = useRef<number | null>(null);
  const autoExpandTargetRef = useRef<string | null>(null);
  const dragPointerYRef = useRef<number | null>(null);
  const dragStartPointerYRef = useRef<number | null>(null);
  const isTrackingPointerRef = useRef(false);

  const clearAutoExpandTimer = () => {
    if (autoExpandTimerRef.current !== null) {
      window.clearTimeout(autoExpandTimerRef.current);
      autoExpandTimerRef.current = null;
    }
    autoExpandTargetRef.current = null;
  };

  const handleGlobalPointerMove = useCallback((event: PointerEvent) => {
    dragPointerYRef.current = event.clientY;
  }, []);

  const handleGlobalTouchMove = useCallback((event: TouchEvent) => {
    const touch = event.touches[0] || event.changedTouches[0];
    if (!touch) return;
    dragPointerYRef.current = touch.clientY;
  }, []);

  const startPointerTracking = useCallback(() => {
    if (isTrackingPointerRef.current) return;
    window.addEventListener("pointermove", handleGlobalPointerMove, { passive: true });
    window.addEventListener("touchmove", handleGlobalTouchMove, { passive: true });
    isTrackingPointerRef.current = true;
  }, [handleGlobalPointerMove, handleGlobalTouchMove]);

  const stopPointerTracking = useCallback(() => {
    if (!isTrackingPointerRef.current) return;
    window.removeEventListener("pointermove", handleGlobalPointerMove);
    window.removeEventListener("touchmove", handleGlobalTouchMove);
    isTrackingPointerRef.current = false;
  }, [handleGlobalPointerMove, handleGlobalTouchMove]);

  useEffect(() => {
    return () => {
      stopPointerTracking();
      if (autoExpandTimerRef.current !== null) {
        window.clearTimeout(autoExpandTimerRef.current);
      }
    };
  }, [stopPointerTracking]);

  const autoScrollVertical = (activeRect: { top: number; bottom: number } | null) => {
    const container = scrollRef.current;
    if (!container || !activeRect) return;

    const containerRect = container.getBoundingClientRect();
    const edge = 42;
    const step = 18;

    if (activeRect.top < containerRect.top + edge) {
      container.scrollTop -= step;
      return;
    }

    if (activeRect.bottom > containerRect.bottom - edge) {
      container.scrollTop += step;
    }
  };

  const handleDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    resetTitleReveal();
    setActiveId(String(active.id));
    setDropIntent(null);
    clearAutoExpandTimer();
    startPointerTracking();
    const translatedRect = active.rect.current.translated ?? active.rect.current.initial;
    dragPointerYRef.current =
      getClientYFromActivator(activatorEvent) ??
      getDragCenterY(translatedRect, activatorEvent);
    dragStartPointerYRef.current = dragPointerYRef.current;
    emitDragGuide({ direction: "left", mode: "sort" });
  };

  const handleDragMove = ({ active, delta }: DragMoveEvent) => {
    const translatedRect = active.rect.current.translated ?? active.rect.current.initial;
    if (dragStartPointerYRef.current !== null) {
      dragPointerYRef.current = dragStartPointerYRef.current + delta.y;
    } else {
      dragPointerYRef.current = getDragCenterY(translatedRect, undefined);
    }
    autoScrollVertical(translatedRect);
  };

  const { handleDragOver } = useDragOver({
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
  });

  const { handleDragEnd } = useDragEnd({
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
  });

  const handleDragCancel = () => {
    resetTitleReveal();
    clearAutoExpandTimer();
    stopPointerTracking();
    setActiveId(null);
    setDropIntent(null);
    emitDragGuide(null);
    dragPointerYRef.current = null;
    dragStartPointerYRef.current = null;
  };

  return {
    handleDragCancel,
    handleDragEnd,
    handleDragMove,
    handleDragOver,
    handleDragStart,
  };
}
