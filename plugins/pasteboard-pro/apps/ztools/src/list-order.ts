import type { PasteItem } from "@pasteboard-pro/core";

import {
  SMART_IMAGE_PINBOARD_ID,
  SMART_TEXT_PINBOARD_ID,
} from "./smart-pinboards";

export const LIST_REORDER_MIME = "application/x-pasteboard-pro-reorder";
export type ListDropPosition = "before" | "after";
export type ListReorderShift = number;
export type ListReorderRequest = Readonly<{
  sourceIds: readonly string[];
  targetId: string;
  position: ListDropPosition;
}>;

export function collapsedDragSourceShifts(
  itemIds: readonly string[],
  sourceId: string,
): ReadonlyMap<string, ListReorderShift> {
  return collapsedDragSourcesShifts(itemIds, [sourceId]);
}

export function collapsedDragSourcesShifts(
  itemIds: readonly string[],
  sourceIds: readonly string[],
): ReadonlyMap<string, ListReorderShift> {
  const sourceSet = new Set(sourceIds.filter((itemId) => itemIds.includes(itemId)));
  const shifts = new Map<string, ListReorderShift>();
  let removedBefore = 0;
  for (const itemId of itemIds) {
    if (sourceSet.has(itemId)) {
      removedBefore += 1;
    } else if (removedBefore > 0) {
      shifts.set(itemId, -removedBefore);
    }
  }
  return shifts;
}

export function listOrderScope(activePinboardId: string | undefined): string {
  if (activePinboardId === undefined) return "all";
  if (activePinboardId === SMART_TEXT_PINBOARD_ID) return "smart:text";
  if (activePinboardId === SMART_IMAGE_PINBOARD_ID) return "smart:image";
  return `pinboard:${encodeURIComponent(activePinboardId)}`;
}

export function applyListOrder(
  items: readonly PasteItem[],
  orderedIds: readonly string[],
): PasteItem[] {
  if (orderedIds.length === 0) return [...items];
  const positions = new Map(orderedIds.map((id, index) => [id, index] as const));
  return items
    .map((item, index) => ({ item, index, position: positions.get(item.id) }))
    .sort((left, right) => {
      if (left.position === undefined && right.position === undefined) {
        return left.index - right.index;
      }
      if (left.position === undefined) return -1;
      if (right.position === undefined) return 1;
      return left.position - right.position;
    })
    .map(({ item }) => item);
}

export function reorderItemIds(
  itemIds: readonly string[],
  sourceId: string,
  targetId: string,
  position: ListDropPosition,
): string[] {
  return reorderItemGroupIds(itemIds, [sourceId], targetId, position);
}

export function reorderItemGroupIds(
  itemIds: readonly string[],
  sourceIds: readonly string[],
  targetId: string,
  position: ListDropPosition,
): string[] {
  const sourceSet = new Set(sourceIds.filter((itemId) => itemIds.includes(itemId)));
  if (sourceSet.size === 0 || sourceSet.has(targetId) || !itemIds.includes(targetId)) {
    return [...itemIds];
  }
  const moved = itemIds.filter((itemId) => sourceSet.has(itemId));
  const reordered = itemIds.filter((itemId) => !sourceSet.has(itemId));
  const nextTargetIndex = reordered.indexOf(targetId);
  reordered.splice(nextTargetIndex + (position === "after" ? 1 : 0), 0, ...moved);
  return reordered;
}

export function reorderItemShifts(
  itemIds: readonly string[],
  sourceId: string,
  targetId: string,
  position: ListDropPosition,
): ReadonlyMap<string, ListReorderShift> {
  return reorderItemGroupShifts(itemIds, [sourceId], targetId, position);
}

export function reorderItemGroupShifts(
  itemIds: readonly string[],
  sourceIds: readonly string[],
  targetId: string,
  position: ListDropPosition,
): ReadonlyMap<string, ListReorderShift> {
  const sourceSet = new Set(sourceIds);
  const reordered = reorderItemGroupIds(itemIds, sourceIds, targetId, position);
  const originalPositions = new Map(
    itemIds.map((itemId, index) => [itemId, index] as const),
  );
  const shifts = new Map<string, ListReorderShift>();
  for (const [nextIndex, itemId] of reordered.entries()) {
    if (sourceSet.has(itemId)) continue;
    const originalIndex = originalPositions.get(itemId);
    if (originalIndex === undefined || originalIndex === nextIndex) continue;
    shifts.set(itemId, nextIndex - originalIndex);
  }
  return shifts;
}
