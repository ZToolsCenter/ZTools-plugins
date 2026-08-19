import {
  closestCenter,
  pointerWithin,
  PointerSensor,
  type Collision,
  type CollisionDetection,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNotebooks } from "@/stores/useNotebooks";
import { usePages } from "@/stores/usePages";
import type { Page } from "@/types";
import { LocalFolderLoadingSkeleton } from "./LocalFolderLoadingSkeleton";
import { buildSidebarTitleDisambiguationMap } from "./sidebar-title-disambiguation";
import { buildVisibleTree, type FlatTreeItem } from "./tree-dnd";
import {
  useTreeDragHandlers,
  type DropIntent,
  type SidebarDragGuide,
} from "./tree/useTreeDragHandlers";
import { TreeViewport } from "./tree/TreeViewport";
import { TreeEmptyState } from "./tree/TreeEmptyState";

interface SidebarTreeProps {
  activeNotebookId: string | null;
  selectedPageId?: string | null;
  width: number;
  rowHeight: number;
  itemHeight: number;
  viewportHeight: number;
  onCreatePage: () => void;
  onDragGuideChange?: (guide: SidebarDragGuide | null) => void;
  rootPageIds?: string[];
  fitContent?: boolean;
  showEmptyState?: boolean;
  allowNest?: boolean;
  resolveSiblings?: (parentId: string | undefined) => Page[];
  onReorder?: (ids: string[], parentId: string | undefined) => void;
  showAddChildButton?: boolean;
  draggablePageIds?: string[];
  flatRoots?: boolean;
}

class LeftButtonPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent }: { nativeEvent: PointerEvent }) =>
        nativeEvent.isPrimary &&
        nativeEvent.button === 0 &&
        !nativeEvent.ctrlKey,
    },
  ];
}

export function SidebarTree({
  activeNotebookId,
  selectedPageId,
  width,
  rowHeight,
  itemHeight,
  viewportHeight,
  onCreatePage,
  onDragGuideChange,
  rootPageIds,
  fitContent = false,
  showEmptyState = true,
  allowNest = true,
  resolveSiblings,
  onReorder,
  showAddChildButton = true,
  draggablePageIds,
  flatRoots = false,
}: SidebarTreeProps) {
  const {
    pages,
    activePageId,
    reorderPages,
    getChildren,
    expandPageId,
    setExpandPageId,
  } = usePages();
  // selectedPageId 传 null 表示"不高亮任何项"（如 AI 界面打开时），undefined 才 fallback 到 activePageId
  const highlightedPageId =
    selectedPageId !== undefined ? selectedPageId : activePageId;

  const notebook = activeNotebookId
    ? useNotebooks.getState().notebooks[activeNotebookId]
    : undefined;
  const isLocalNotebook = notebook?.source === "local-folder";
  const localLoadStatus = useNotebooks((state) =>
    activeNotebookId
      ? (state.localFolderLoadStates[activeNotebookId]?.status ?? "idle")
      : "idle",
  );
  const shouldShowLocalSkeleton =
    !rootPageIds && isLocalNotebook && localLoadStatus === "loading";

  const [openPageIds, setOpenPageIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropIntent, setDropIntent] = useState<DropIntent | null>(null);
  const [titleRevealResetSignal, setTitleRevealResetSignal] = useState(0);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragGuideKeyRef = useRef<string>("__init__");

  const visibleItems = useMemo(
    () =>
      buildVisibleTree({
        pages,
        openIds: openPageIds,
        workspaceId: activeNotebookId || undefined,
        isLocalNotebook,
        rootPageIds,
        flatRoots,
      }),
    [
      pages,
      openPageIds,
      activeNotebookId,
      isLocalNotebook,
      rootPageIds,
      flatRoots,
    ],
  );

  const activeDescendantIds = useMemo(() => {
    // flatRoots 模式（收藏区平铺列表）下所有 item 视为虚拟根的直接子项，
    // 不存在祖先-后代关系，强制返回空集，避免误拦截平铺重排。
    if (!activeId || flatRoots) return new Set<string>();
    const descendants = new Set<string>();
    const stack = [activeId];

    while (stack.length > 0) {
      const currentId = stack.pop()!;
      Object.values(pages).forEach((page) => {
        if (page.trashedAt || page.parentId !== currentId) return;
        descendants.add(page.id);
        stack.push(page.id);
      });
    }

    return descendants;
  }, [activeId, pages, flatRoots]);

  const renderItems = useMemo(
    () =>
      activeId
        ? visibleItems.filter((item) =>
            "isPlaceholder" in item ? true : !activeDescendantIds.has(item.id),
          )
        : visibleItems,
    [visibleItems, activeId, activeDescendantIds],
  );
  const titleDisambiguationMap = useMemo(
    () =>
      buildSidebarTitleDisambiguationMap({
        pages,
        activeNotebookId,
        notebook,
        rootPageIds,
      }),
    [pages, activeNotebookId, notebook, rootPageIds],
  );

  const flatItems = useMemo(
    () =>
      renderItems.filter(
        (item) => !("isPlaceholder" in item),
      ) as FlatTreeItem[],
    [renderItems],
  );
  const draggablePageIdSet = useMemo(
    () => (draggablePageIds ? new Set(draggablePageIds) : null),
    [draggablePageIds],
  );

  const visibleIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    renderItems.forEach((item, index) => {
      if ("isPlaceholder" in item) return;
      map.set(item.id, index);
    });
    return map;
  }, [renderItems]);
  const resetTitleReveal = useCallback(() => {
    setTitleRevealResetSignal((current) => current + 1);
  }, []);

  const DragSensor = LeftButtonPointerSensor;
  const sensors = useSensors(
    useSensor(DragSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
  );
  const collisionDetection: CollisionDetection = useCallback((args) => {
    const filterSelf = (collisions: Collision[]) =>
      collisions.filter(
        (collision) => String(collision.id) !== String(args.active.id),
      );
    const pointerHits = filterSelf(pointerWithin(args));
    if (pointerHits.length > 0) {
      return pointerHits;
    }
    return filterSelf(closestCenter(args));
  }, []);

  const virtualizer = useVirtualizer({
    count: renderItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  });

  const handleToggle = useCallback((id: string) => {
    setOpenPageIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const getSiblingPages = useCallback(
    (parentId: string | undefined) => {
      if (resolveSiblings) {
        return resolveSiblings(parentId);
      }
      return getChildren(parentId, activeNotebookId || undefined);
    },
    [resolveSiblings, getChildren, activeNotebookId],
  );

  useEffect(() => {
    if (!expandPageId) return;

    const page = pages[expandPageId];
    if (!page) return;
    if (page.trashedAt) {
      setExpandPageId(null);
      return;
    }
    if (activeNotebookId && page.workspaceId !== activeNotebookId) {
      return;
    }

    const ancestorIds: string[] = [];
    let current = page;
    while (current.parentId && pages[current.parentId]) {
      ancestorIds.push(current.parentId);
      current = pages[current.parentId];
    }

    setOpenPageIds((prev) => {
      const next = new Set(prev);
      ancestorIds.forEach((id) => next.add(id));
      return next;
    });

    const timer = window.setTimeout(() => {
      const index = renderItems.findIndex((item) => item.id === expandPageId);
      if (index >= 0) {
        virtualizer.scrollToIndex(index, { align: "center" });
      }
    }, 80);

    setExpandPageId(null);
    return () => window.clearTimeout(timer);
  }, [
    expandPageId,
    pages,
    activeNotebookId,
    setExpandPageId,
    renderItems,
    virtualizer,
  ]);

  const emitDragGuide = useCallback(
    (guide: SidebarDragGuide | null) => {
      if (!onDragGuideChange) return;
      const key = guide ? `${guide.direction}:${guide.mode}` : "__none__";
      if (dragGuideKeyRef.current === key) return;
      dragGuideKeyRef.current = key;
      onDragGuideChange(guide);
    },
    [onDragGuideChange],
  );

  useEffect(() => {
    return () => {
      onDragGuideChange?.(null);
    };
  }, [onDragGuideChange]);

  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      resetTitleReveal();
    };

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      scrollContainer.removeEventListener("scroll", handleScroll);
    };
  }, [resetTitleReveal]);

  const {
    handleDragCancel,
    handleDragEnd,
    handleDragMove,
    handleDragOver,
    handleDragStart,
  } = useTreeDragHandlers({
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
  });

  if (shouldShowLocalSkeleton) {
    return <LocalFolderLoadingSkeleton />;
  }

  if (flatItems.length === 0) {
    if (!showEmptyState) return null;
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col">
        <TreeEmptyState
          isLocalNotebook={isLocalNotebook}
          width={width}
          height={viewportHeight}
          onCreatePage={onCreatePage}
        />
      </div>
    );
  }

  const contentHeight = fitContent
    ? Math.max(renderItems.length * rowHeight, rowHeight)
    : Math.max(virtualizer.getTotalSize(), viewportHeight || 0);

  return (
    <TreeViewport
      activeId={activeId}
      collisionDetection={collisionDetection}
      contentHeight={contentHeight}
      draggablePageIdSet={draggablePageIdSet}
      dropIntent={dropIntent}
      fitContent={fitContent}
      handleDragCancel={handleDragCancel}
      handleDragEnd={handleDragEnd}
      handleDragMove={handleDragMove}
      handleDragOver={handleDragOver}
      handleDragStart={handleDragStart}
      highlightedPageId={highlightedPageId}
      isLocalNotebook={isLocalNotebook}
      itemHeight={itemHeight}
      renderItems={renderItems}
      rowHeight={rowHeight}
      scrollRef={scrollRef}
      sensors={sensors}
      showAddChildButton={showAddChildButton}
      titleDisambiguationMap={titleDisambiguationMap}
      titleRevealResetSignal={titleRevealResetSignal}
      virtualItems={virtualizer.getVirtualItems()}
      viewportHeight={viewportHeight}
      width={width}
      onToggleOpen={handleToggle}
    />
  );
}
