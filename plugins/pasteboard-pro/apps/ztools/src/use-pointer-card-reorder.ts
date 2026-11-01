import { computed, shallowRef, watch, type ComputedRef, type Ref } from "vue";

import type { PasteItem } from "@pasteboard-pro/core";

import {
  collapsedDragSourcesShifts,
  reorderItemGroupShifts,
  type ListDropPosition,
  type ListReorderRequest,
} from "./list-order";
import {
  createCardReorderDragPreview,
  type CardReorderDragPreview,
} from "./card-reorder-drag-preview";
import {
  createPointerReorderSession,
  type PointerReorderFinish,
  type PointerReorderSession,
} from "./pointer-reorder-session";

type ReorderTarget = Readonly<{ itemId: string; position: ListDropPosition }>;
type ActiveReorder = Readonly<{
  itemId: string;
  sourceIds: readonly string[];
  mountedIds: readonly string[];
  items: readonly PasteItem[];
  itemIds: readonly string[];
  scope: string;
  target: ReorderTarget | undefined;
  preview: CardReorderDragPreview | undefined;
}>;
type PointerPoint = Readonly<{ clientX: number; clientY: number }>;

export type PointerCardReorderOptions = Readonly<{
  items: Ref<readonly PasteItem[]>;
  selectedIds: Ref<readonly string[]>;
  reorderEnabled: Ref<boolean | undefined>;
  reorderScope: Ref<string | undefined>;
  vertical: Ref<boolean | undefined>;
  cardSize: Ref<number>;
  stride: ComputedRef<number>;
  track: Ref<HTMLElement | null | undefined>;
  getMountedItemIds: (itemId: string, sourceIds: readonly string[]) => readonly string[];
  onReorder: (request: ListReorderRequest) => void;
  onActiveChange: (active: boolean) => void;
  onItemsRefresh: (items: readonly PasteItem[], previousItems: readonly PasteItem[]) => void;
}>;

/** Owns pointer sorting state, its frozen view, slot hit-testing, and cleanup. */
export function usePointerCardReorder(options: PointerCardReorderOptions) {
  const activeReorder = shallowRef<ActiveReorder>();
  const pointerSession = shallowRef<PointerReorderSession>();
  const effectiveItems = computed(() => activeReorder.value?.items ?? options.items.value);
  const selectedIdSet = computed(() => new Set(options.selectedIds.value));
  const orderedSelectedIds = computed(() => effectiveItems.value
    .filter((item) => selectedIdSet.value.has(item.id)).map((item) => item.id));
  const draggedItemIds = computed(() => activeReorder.value?.sourceIds ?? []);
  const draggedItemIdSet = computed(() => new Set(draggedItemIds.value));
  const mountedDragIds = computed(() => activeReorder.value?.mountedIds ?? []);
  const reorderTarget = computed(() => activeReorder.value?.target);
  const reorderShifts = computed(() => {
    const sourceIds = draggedItemIds.value;
    const target = reorderTarget.value;
    if (sourceIds.length === 0) return new Map<string, number>();
    const itemIds = activeReorder.value?.itemIds ?? [];
    if (target === undefined) return collapsedDragSourcesShifts(itemIds, sourceIds);
    return reorderItemGroupShifts(itemIds, sourceIds, target.itemId, target.position);
  });

  let pendingPointerItemId: string | undefined;
  let itemsChangedDuringReorder = false;
  let unmounting = false;
  let suppressClickUntil = 0;
  let suppressClickTimer: number | undefined;

  function reorderItemIdsFor(itemId: string): readonly string[] {
    return selectedIdSet.value.has(itemId) ? orderedSelectedIds.value : [itemId];
  }

  function pointIsInsideTrack(point: PointerPoint): boolean {
    const element = options.track.value;
    if (element == null) return false;
    const bounds = element.getBoundingClientRect();
    return point.clientX >= bounds.left && point.clientX <= bounds.right &&
      point.clientY >= bounds.top && point.clientY <= bounds.bottom;
  }

  function setReorderTarget(target: ReorderTarget | undefined): void {
    const current = activeReorder.value;
    if (current === undefined) return;
    if (current.target?.itemId === target?.itemId && current.target?.position === target?.position) return;
    activeReorder.value = { ...current, target };
  }

  function updateReorderTarget(point: PointerPoint): void {
    const active = activeReorder.value;
    const element = options.track.value;
    active?.preview?.move(point.clientX, point.clientY);
    if (active === undefined || element == null || !pointIsInsideTrack(point)) {
      setReorderTarget(undefined);
      return;
    }

    const items = active.items;
    if (items.length === 0) {
      setReorderTarget(undefined);
      return;
    }
    const bounds = element.getBoundingClientRect();
    const css = getComputedStyle(element);
    const vertical = options.vertical.value === true;
    const axisOrigin = vertical
      ? bounds.top + element.clientTop + Number.parseFloat(css.paddingTop)
      : bounds.left + element.clientLeft + Number.parseFloat(css.paddingLeft);
    const axisPosition = vertical
      ? point.clientY - axisOrigin + element.scrollTop
      : point.clientX - axisOrigin + element.scrollLeft;
    const extent = items.length * options.stride.value;
    let index: number;
    let position: ListDropPosition;
    if (axisPosition <= 0) {
      index = 0;
      position = "before";
    } else if (axisPosition >= extent) {
      index = items.length - 1;
      position = "after";
    } else {
      index = Math.min(items.length - 1, Math.floor(axisPosition / options.stride.value));
      const withinSlot = axisPosition - index * options.stride.value;
      position = withinSlot < options.cardSize.value / 2 ? "before" : "after";
    }
    const target = items[index];
    if (target === undefined || draggedItemIdSet.value.has(target.id)) {
      setReorderTarget(undefined);
      return;
    }
    setReorderTarget({ itemId: target.id, position });
  }

  function finishReorder(result: PointerReorderFinish): void {
    pointerSession.value = undefined;
    pendingPointerItemId = undefined;
    const active = activeReorder.value;
    if (active === undefined) return;

    const point = result.event === undefined
      ? undefined
      : { clientX: result.event.clientX, clientY: result.event.clientY };
    const latestIds = new Set(options.items.value.map((item) => item.id));
    const sourcesStillExist = active.sourceIds.every((itemId) => latestIds.has(itemId));
    const targetStillExists = active.target === undefined || latestIds.has(active.target.itemId);
    const canCommit = !unmounting && result.dragged && !result.cancelled &&
      point !== undefined && pointIsInsideTrack(point) && options.reorderEnabled.value !== false &&
      (options.reorderScope.value ?? "all") === active.scope && sourcesStillExist && targetStillExists &&
      active.sourceIds.length > 0 && active.target !== undefined;

    active.preview?.remove();
    activeReorder.value = undefined;
    options.onActiveChange(false);
    if (result.dragged) armClickSuppression();
    try {
      if (canCommit && active.target !== undefined) {
        options.onReorder({
          sourceIds: active.sourceIds,
          targetId: active.target.itemId,
          position: active.target.position,
        });
      }
    } finally {
      if (itemsChangedDuringReorder) {
        itemsChangedDuringReorder = false;
        options.onItemsRefresh(options.items.value, active.items);
      }
    }
  }

  function beginPointerReorder(itemId: string, event: PointerEvent, sourceCard: HTMLElement): void {
    if (options.reorderEnabled.value === false || event.button !== 0 || !event.isPrimary) return;
    pointerSession.value?.cancel();
    const sourceIds = reorderItemIdsFor(itemId);
    const captureTarget = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-pb-reorder-handle]")
      : null;
    if (captureTarget === null) return;
    pendingPointerItemId = itemId;
    const session = createPointerReorderSession(event, captureTarget, {
      threshold: 5,
      onStart: (pointer) => {
        if (options.reorderEnabled.value === false ||
          !sourceIds.every((sourceId) => options.items.value.some((item) => item.id === sourceId))) return;
        const mountedIds = options.getMountedItemIds(itemId, sourceIds);
        const preview = createCardReorderDragPreview(
          sourceCard,
          sourceIds.length,
          pointer.clientX,
          pointer.clientY,
        );
        const items = options.items.value;
        activeReorder.value = {
          itemId,
          sourceIds,
          mountedIds: mountedIds.includes(itemId) ? mountedIds : [...mountedIds, itemId],
          items,
          itemIds: items.map((item) => item.id),
          scope: options.reorderScope.value ?? "all",
          target: undefined,
          preview,
        };
        options.onActiveChange(true);
        updateReorderTarget(pointer);
      },
      onMove: updateReorderTarget,
      onFinish: finishReorder,
    });
    pointerSession.value = session;
  }

  function cancelPointerReorder(): void {
    const session = pointerSession.value;
    pointerSession.value = undefined;
    session?.cancel();
  }

  function clearClickSuppression(): void {
    document.removeEventListener("click", handleReorderClick, true);
    document.removeEventListener("pointerdown", resetClickSuppression, true);
    if (suppressClickTimer !== undefined) window.clearTimeout(suppressClickTimer);
    suppressClickTimer = undefined;
    suppressClickUntil = 0;
  }

  function armClickSuppression(): void {
    clearClickSuppression();
    suppressClickUntil = performance.now() + 450;
    document.addEventListener("click", handleReorderClick, true);
    document.addEventListener("pointerdown", resetClickSuppression, true);
    suppressClickTimer = window.setTimeout(clearClickSuppression, 450);
  }

  function handleReorderClick(event: MouseEvent): void {
    if (event.detail === 0 || performance.now() > suppressClickUntil) {
      clearClickSuppression();
      return;
    }
    clearClickSuppression();
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function resetClickSuppression(): void {
    clearClickSuppression();
  }

  /** Returns true when the caller must defer its normal viewport anchoring. */
  function handleItemsChanged(items: readonly PasteItem[]): boolean {
    const active = activeReorder.value;
    if (active !== undefined) {
      const nextIds = new Set(items.map((item) => item.id));
      const targetStillExists = active.target === undefined || nextIds.has(active.target.itemId);
      itemsChangedDuringReorder = true;
      if (
        !active.sourceIds.every((itemId) => nextIds.has(itemId)) ||
        !targetStillExists ||
        options.reorderEnabled.value === false ||
        (options.reorderScope.value ?? "all") !== active.scope
      ) cancelPointerReorder();
      return true;
    }
    if (pointerSession.value !== undefined &&
      (pendingPointerItemId === undefined || !items.some((item) => item.id === pendingPointerItemId))) {
      cancelPointerReorder();
    }
    return false;
  }

  watch([options.reorderEnabled, options.reorderScope], ([enabled, scope], [, previousScope]) => {
    if (enabled === false || scope !== previousScope) {
      cancelPointerReorder();
    }
  });

  return {
    activeReorder,
    effectiveItems,
    itemPositions: computed(() => new Map(effectiveItems.value.map((item, index) => [item.id, index]))),
    orderedSelectedIds,
    draggedItemIds,
    draggedItemIdSet,
    mountedDragIds,
    reorderTarget,
    reorderShifts,
    reorderItemIdsFor,
    beginPointerReorder,
    cancelPointerReorder,
    handleReorderClick,
    resetClickSuppression,
    handleItemsChanged,
    dispose: () => {
      unmounting = true;
      cancelPointerReorder();
      clearClickSuppression();
      activeReorder.value?.preview?.remove();
      activeReorder.value = undefined;
    },
  };
}
