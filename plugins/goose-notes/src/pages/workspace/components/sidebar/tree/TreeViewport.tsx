import {
  DndContext,
  DragOverlay,
  type CollisionDetection,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { VirtualItem } from "@tanstack/react-virtual";
import type { CSSProperties, ComponentProps, RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { getPageTitle } from "@/components/editor/utils/page-title";
import type { VisibleTreeItem } from "../tree-dnd";
import {
  BOTTOM_EDGE_DROP_ID,
  TOP_EDGE_DROP_ID,
  type DropIntent,
} from "./useTreeDragHandlers";
import {
  EdgeDropZone,
  PlaceholderRow,
  SortablePageRow,
  TreeDragOverlay,
} from "./TreeRow";
import { useSettings } from "@/stores/useSettings";
import { TREE_INDENT } from "./useTreeDnd";

// 与 TreeRow / MainTreeItem 保持一致：蓝点落在图标左缘，而非展开箭头区
const ROW_PADDING_LEFT = 6;
const ARROW_SLOT = 6 + 20; // ml-1.5 + w-5（TreeRow 无 gap-0.5）

type DndContextProps = ComponentProps<typeof DndContext>;

interface TreeViewportProps {
  activeId: string | null;
  collisionDetection: CollisionDetection;
  contentHeight: number;
  draggablePageIdSet: Set<string> | null;
  dropIntent: DropIntent | null;
  fitContent: boolean;
  handleDragCancel: DndContextProps["onDragCancel"];
  handleDragEnd: DndContextProps["onDragEnd"];
  handleDragMove: DndContextProps["onDragMove"];
  handleDragOver: DndContextProps["onDragOver"];
  handleDragStart: DndContextProps["onDragStart"];
  highlightedPageId: string | null | undefined;
  isLocalNotebook: boolean;
  itemHeight: number;
  renderItems: VisibleTreeItem[];
  rowHeight: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  sensors: DndContextProps["sensors"];
  showAddChildButton: boolean;
  titleDisambiguationMap: Map<string, string>;
  titleRevealResetSignal: number;
  virtualItems: VirtualItem[];
  viewportHeight: number;
  width: number;
  onToggleOpen: (id: string) => void;
}

export function TreeViewport({
  activeId,
  collisionDetection,
  contentHeight,
  draggablePageIdSet,
  dropIntent,
  fitContent,
  handleDragCancel,
  handleDragEnd,
  handleDragMove,
  handleDragOver,
  handleDragStart,
  highlightedPageId,
  isLocalNotebook,
  itemHeight,
  renderItems,
  rowHeight,
  scrollRef,
  sensors,
  showAddChildButton,
  titleDisambiguationMap,
  titleRevealResetSignal,
  virtualItems,
  viewportHeight,
  width,
  onToggleOpen,
}: TreeViewportProps) {
  const hideExpandArrows = useSettings((s) => s.hideExpandArrows);
  const rows: Array<{ item: VisibleTreeItem; size: number; start: number }> =
    fitContent
      ? renderItems.map((item, index) => ({
          item,
          size: rowHeight,
          start: index * rowHeight,
        }))
      : virtualItems.flatMap((virtualRow) => {
          const item = renderItems[virtualRow.index];
          if (!item) return [];
          return [
            {
              item,
              size: virtualRow.size,
              start: virtualRow.start,
            },
          ];
        });

  const flatItemIds = renderItems.flatMap((item) =>
    "isPlaceholder" in item ? [] : [item.id],
  );
  const activeItem = activeId
    ? renderItems.find(
        (item) => !("isPlaceholder" in item) && item.id === activeId,
      )
    : undefined;

  return (
    <div
      className={cn(
        "w-full relative",
        fitContent ? "overflow-visible" : "h-full overflow-hidden",
      )}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
        autoScroll={false}
      >
        <SortableContext
          items={flatItemIds}
          strategy={verticalListSortingStrategy}
        >
          <div
            ref={scrollRef}
            className={cn(
              "overflow-x-hidden",
              fitContent ? "overflow-y-visible" : "h-full overflow-y-auto",
            )}
            style={
              fitContent
                ? { width, minHeight: contentHeight }
                : { width, minHeight: viewportHeight || 0 }
            }
          >
            <div
              style={{
                height: contentHeight,
                width: "100%",
                position: "relative",
              }}
            >
              <EdgeDropZone id={TOP_EDGE_DROP_ID} top={0} height={14} />
              <EdgeDropZone
                id={BOTTOM_EDGE_DROP_ID}
                top={contentHeight - 14}
                height={14}
              />
              {rows.map((row) => {
                const item = row.item;
                const style: CSSProperties = {
                  position: "absolute",
                  top: row.start,
                  left: 0,
                  width: "100%",
                  height: row.size,
                };

                if ("isPlaceholder" in item) {
                  return (
                    <PlaceholderRow
                      key={item.id}
                      style={style}
                      depth={item.depth}
                      name={item.name}
                    />
                  );
                }

                const isDropTarget =
                  dropIntent?.overId === item.id && activeId !== item.id;
                const isNestDropTarget =
                  isDropTarget && dropIntent?.kind === "nest";
                const showDropLine =
                  isDropTarget && dropIntent?.kind !== "nest";
                const dropLinePosition =
                  dropIntent?.kind === "after" ? "bottom" : "top";
                const dropLineLeft =
                  item.depth * TREE_INDENT +
                  ROW_PADDING_LEFT +
                  (hideExpandArrows ? 0 : ARROW_SLOT);
                const dragEnabled = draggablePageIdSet
                  ? draggablePageIdSet.has(item.id)
                  : true;
                const titleText = getPageTitle(item.page);
                const disambiguation = titleDisambiguationMap.get(item.id);
                const expandedTitleText = disambiguation
                  ? `${titleText} · ${disambiguation}`
                  : titleText;

                return (
                  <SortablePageRow
                    key={item.id}
                    item={item}
                    rowStyle={style}
                    depth={item.depth}
                    itemHeight={itemHeight}
                    isLocalNotebook={isLocalNotebook}
                    isActive={highlightedPageId === item.id}
                    isNestDropTarget={isNestDropTarget}
                    showDropLine={showDropLine}
                    dropLinePosition={dropLinePosition}
                    dropLineLeft={dropLineLeft}
                    onToggleOpen={onToggleOpen}
                    showAddChildButton={showAddChildButton}
                    dragEnabled={dragEnabled}
                    titleText={titleText}
                    expandedTitleText={expandedTitleText}
                    revealResetSignal={titleRevealResetSignal}
                    titleRevealDisabled={activeId !== null}
                  />
                );
              })}
            </div>
          </div>
        </SortableContext>
        {typeof document !== "undefined" &&
          createPortal(
            <DragOverlay dropAnimation={null} zIndex={80}>
              {activeItem && !("isPlaceholder" in activeItem) ? (
                <TreeDragOverlay
                  item={activeItem}
                  width={width}
                  isLocalNotebook={isLocalNotebook}
                />
              ) : null}
            </DragOverlay>,
            document.body,
          )}
      </DndContext>
    </div>
  );
}
