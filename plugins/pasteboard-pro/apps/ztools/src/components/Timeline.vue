<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, toRef, watch } from "vue";

import type { PasteItem, Pinboard } from "@pasteboard-pro/core";

import type { ListReorderRequest } from "../list-order";
import { usePointerCardReorder } from "../use-pointer-card-reorder";
import { timelineFocusOffset, timelineRange } from "../virtual-timeline";
import PasteCard from "./PasteCard.vue";

const props = withDefaults(
  defineProps<{
    items: readonly PasteItem[];
    total?: number;
    hasMore?: boolean;
    pinboards: readonly Pinboard[];
    selectedIds: readonly string[];
    focusedId: string | undefined;
    vertical?: boolean;
    compact?: boolean;
    reorderEnabled?: boolean;
    reorderScope?: string;
  }>(),
  { vertical: false, compact: false, reorderEnabled: true, reorderScope: "all" },
);

const emit = defineEmits<{
  loadMore: [];
  select: [itemId: string, extend: boolean, toggle: boolean];
  paste: [itemId: string];
  preview: [itemId: string];
  latestVisible: [itemId: string];
  assignPinboard: [pinboardId: string | undefined, itemId: string];
  createPinboard: [];
  reorder: [value: ListReorderRequest];
  pointerReorderActive: [active: boolean];
}>();

const track = ref<HTMLElement | null>();
const followLatest = ref(true);
const offset = ref(0);
const viewport = ref(800);
const cardSize = ref(240);
const gap = computed(() => props.vertical && props.compact ? 8 : 12);
const stride = computed(() => cardSize.value + gap.value);
const selectedIdSet = computed(() => new Set(props.selectedIds));
let getRenderedReorderIds: (itemId: string, sourceIds: readonly string[]) => readonly string[] = () => [];
const reorder = usePointerCardReorder({
  items: toRef(props, "items"),
  selectedIds: toRef(props, "selectedIds"),
  reorderEnabled: toRef(props, "reorderEnabled"),
  reorderScope: toRef(props, "reorderScope"),
  vertical: toRef(props, "vertical"),
  cardSize,
  stride,
  track,
  getMountedItemIds: (itemId, sourceIds) => getRenderedReorderIds(itemId, sourceIds),
  onReorder: (request) => emit("reorder", request),
  onActiveChange: (active) => emit("pointerReorderActive", active),
  onItemsRefresh: restoreViewportForItems,
});
const {
  activeReorder,
  effectiveItems,
  itemPositions,
  draggedItemIds,
  draggedItemIdSet,
  mountedDragIds,
  reorderTarget,
  reorderShifts,
  beginPointerReorder,
} = reorder;
const range = computed(() => timelineRange(
  effectiveItems.value.length, stride.value, offset.value, viewport.value,
));
const projectedIndexes = computed(() => {
  const items = effectiveItems.value;
  const indexes: Array<number | undefined> = new Array(items.length);
  items.forEach((item, index) => {
    if (!draggedItemIdSet.value.has(item.id)) {
      indexes[index + (reorderShifts.value.get(item.id) ?? 0)] = index;
    }
  });
  return indexes;
});
const renderedItems = computed(() => {
  const items = effectiveItems.value;
  const indexes = projectedIndexes.value.slice(range.value.start, range.value.end)
    .filter((index): index is number => index !== undefined);
  const originIndex = activeReorder.value === undefined
    ? undefined : itemPositions.value.get(activeReorder.value.itemId);
  if (originIndex !== undefined && !indexes.includes(originIndex)) indexes.push(originIndex);
  for (const itemId of mountedDragIds.value) {
    const index = itemPositions.value.get(itemId);
    if (index !== undefined && !indexes.includes(index)) indexes.push(index);
  }
  return indexes.sort((a, b) => a - b).map((index) => ({ item: items[index]!, index }));
});
getRenderedReorderIds = (itemId, sourceIds) => renderedItems.value
  .filter(({ item }) => item.id === itemId || sourceIds.includes(item.id))
  .map(({ item }) => item.id);
const contentStyle = computed(() => {
  const extent = Math.max(0, effectiveItems.value.length * stride.value - gap.value);
  return props.vertical
    ? { height: `${extent}px`, width: "100%" }
    : { width: `${extent}px`, height: "var(--pb-card-height)" };
});
let resizeObserver: ResizeObserver | undefined;
let itemsRevision = 0;

function slotStyle(index: number): Record<string, string> {
  return props.vertical
    ? { top: `${index * stride.value}px`, left: "0", width: "100%" }
    : { left: `${index * stride.value}px`, top: "0", width: `${cardSize.value}px` };
}

function scrollOffset(element: HTMLElement): number {
  return props.vertical ? element.scrollTop : element.scrollLeft;
}

function setScrollOffset(element: HTMLElement, value: number): void {
  if (props.vertical) element.scrollTop = value;
  else element.scrollLeft = value;
  updateFollowLatest();
}

function updateFollowLatest(): void {
  const element = track.value;
  if (element == null) return;
  offset.value = scrollOffset(element);
  followLatest.value = offset.value <= 8;
  if (props.hasMore && offset.value + viewport.value >= (effectiveItems.value.length - 15) * stride.value) {
    emit("loadMore");
  }
}

function measureTrack(): void {
  const element = track.value;
  if (element == null) return;
  const css = getComputedStyle(element);
  cardSize.value = props.vertical
    ? Number.parseFloat(css.getPropertyValue("--pb-card-height")) || 142
    : Number.parseFloat(css.getPropertyValue("--pb-card-width")) || 240;
  const padding = props.vertical
    ? Number.parseFloat(css.paddingTop) + Number.parseFloat(css.paddingBottom)
    : Number.parseFloat(css.paddingLeft) + Number.parseFloat(css.paddingRight);
  viewport.value = Math.max(1, (props.vertical ? element.clientHeight : element.clientWidth) - padding);
  updateFollowLatest();
}

function forwardSelect(itemId: string, extend: boolean, toggle: boolean): void {
  emit("select", itemId, extend, toggle);
}

function restoreViewportForItems(
  items: readonly PasteItem[],
  previousItems: readonly PasteItem[],
): void {
  const revision = ++itemsRevision;
  const shouldFollow = followLatest.value;
  const previousIndex = previousItems.length === 0
    ? 0 : Math.min(previousItems.length - 1, Math.floor(offset.value / stride.value));
  const anchorId = previousItems[previousIndex]?.id;
  const withinCard = previousItems.length === 0 ? 0 : offset.value - previousIndex * stride.value;
  const anchorIndex = anchorId === undefined ? -1 : items.findIndex((item) => item.id === anchorId);
  const nextOffset = shouldFollow || anchorIndex < 0
    ? 0 : Math.max(0, anchorIndex * stride.value + withinCard);
  offset.value = nextOffset;
  void nextTick(() => {
    if (revision !== itemsRevision || track.value == null) return;
    measureTrack();
    setScrollOffset(track.value, nextOffset);
    if (nextOffset === 0 && items[0] !== undefined && items[0].id !== previousItems[0]?.id) {
      emit("latestVisible", items[0].id);
    }
  });
}

watch(() => props.items, (items, previousItems) => {
  if (reorder.handleItemsChanged(items)) return;
  restoreViewportForItems(items, previousItems);
});

watch(() => props.focusedId, async (itemId, previousItemId) => {
  if (itemId === undefined || itemId === previousItemId) return;
  await nextTick();
  if (track.value == null || props.focusedId !== itemId) return;
  const index = itemPositions.value.get(itemId);
  if (index === undefined) return;
  setScrollOffset(track.value, timelineFocusOffset(
    index, stride.value, cardSize.value, offset.value, viewport.value,
  ));
});

async function focusItem(itemId: string): Promise<void> {
  await nextTick();
  const element = track.value;
  const index = itemPositions.value.get(itemId);
  if (element == null || index === undefined) return;
  setScrollOffset(element, timelineFocusOffset(
    index, stride.value, cardSize.value, offset.value, viewport.value,
  ));
  await nextTick();
  if (props.focusedId !== itemId) return;
  const card = [...element.querySelectorAll<HTMLElement>("[data-pb-item-id]")]
    .find((candidate) => candidate.dataset.pbItemId === itemId);
  card?.focus({ preventScroll: true });
}

defineExpose({ focusItem });

watch(track, (element) => {
  resizeObserver?.disconnect();
  if (element == null) return;
  measureTrack();
  resizeObserver = new ResizeObserver(measureTrack);
  resizeObserver.observe(element);
  const itemId = effectiveItems.value[0]?.id;
  if (itemId !== undefined && followLatest.value) emit("latestVisible", itemId);
}, { flush: "post" });

watch(() => [props.vertical, props.compact], async () => {
  reorder.cancelPointerReorder();
  const index = Math.floor(offset.value / stride.value);
  await nextTick();
  if (track.value == null) return;
  measureTrack();
  setScrollOffset(track.value, index * stride.value);
});

onBeforeUnmount(() => {
  reorder.dispose();
  resizeObserver?.disconnect();
});
</script>

<template>
  <section
    class="timeline"
    :class="{ 'timeline--vertical': props.vertical, 'timeline--compact': props.compact }"
    aria-label="剪贴板时间线"
  >
    <div v-if="effectiveItems.length === 0" class="empty-state" aria-live="polite">
      <span>LOCAL HISTORY</span>
      <strong>复制内容后会出现在这里</strong>
      <p>Paste剪切板只保存通过隐私规则的本地记录。</p>
    </div>
    <div
      v-else
      ref="track"
      class="timeline__track"
      role="listbox"
      aria-multiselectable="true"
      :data-pb-reorder-active="activeReorder ? 'true' : undefined"
      :data-pb-reorder-source-count="activeReorder?.sourceIds.length"
      :data-pb-reorder-target-id="reorderTarget?.itemId"
      :data-pb-reorder-target-position="reorderTarget?.position"
      @scroll.passive="updateFollowLatest"
    >
      <div class="timeline__content" :style="contentStyle">
        <div
          v-for="{ item, index } in renderedItems"
          :key="item.id"
          class="timeline__slot"
          :style="slotStyle(index)"
        >
          <PasteCard
            :item="item"
            :pinboards="props.pinboards"
            :index="index"
            :selected="selectedIdSet.has(item.id)"
            :total="props.total ?? props.items.length"
            :vertical="props.vertical"
            :compact="props.compact"
            :reorder-enabled="props.reorderEnabled"
            :reorder-active="draggedItemIds.length > 0"
            :reorder-hidden="draggedItemIdSet.has(item.id)"
            :reorder-shift="reorderShifts.get(item.id) ?? 0"
            @select="forwardSelect"
            @paste="emit('paste', $event)"
            @preview="emit('preview', $event)"
            @assign-pinboard="emit('assignPinboard', $event.pinboardId, $event.itemId)"
            @create-pinboard="emit('createPinboard')"
            @reorder-pointer-start="beginPointerReorder"
          />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.timeline {
  min-height: 158px;
  padding: 8px 16px 16px;
  overflow: hidden;
}

.timeline__track {
  --pb-reorder-gap: 12px;
  --pb-card-height: 142px;
  min-height: 150px;
  padding: 4px 3px 12px;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  overflow-anchor: none;
  scrollbar-color: color-mix(in srgb, var(--pb-violet) 30%, transparent) transparent;
  scrollbar-width: thin;
}

.timeline__content {
  position: relative;
}

.timeline__slot {
  position: absolute;
  height: var(--pb-card-height);
}

.timeline--vertical {
  min-height: 0;
  padding: 8px 12px 12px;
}

.timeline--vertical .timeline__track {
  height: 100%;
  min-height: 0;
  padding: 4px 4px 12px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior-y: contain;
}

.timeline--vertical.timeline--compact {
  padding: 6px 10px 10px;
}

.timeline--vertical.timeline--compact .timeline__track {
  --pb-reorder-gap: 8px;
  --pb-card-height: 108px;
  padding: 3px 3px 9px;
}

.empty-state {
  display: grid;
  min-height: 142px;
  place-content: center;
  justify-items: center;
  color: var(--pb-muted);
  text-align: center;
}

.empty-state span {
  color: var(--pb-violet);
  font-size: 9px;
  font-weight: 760;
  letter-spacing: 0.16em;
}

.empty-state strong {
  margin-top: 7px;
  color: var(--pb-ink);
  font-size: 15px;
}

.empty-state p {
  margin: 4px 0 0;
  font-size: 11px;
}
</style>
