<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";

import type { PasteItem } from "@pasteboard-pro/core";

import PasteCard from "./PasteCard.vue";

const props = withDefaults(
  defineProps<{
    items: readonly PasteItem[];
    selectedIds: readonly string[];
    focusedId: string | undefined;
    vertical?: boolean;
    compact?: boolean;
  }>(),
  { vertical: false, compact: false },
);

const emit = defineEmits<{
  select: [itemId: string, extend: boolean, toggle: boolean];
  paste: [itemId: string];
  preview: [itemId: string];
  latestVisible: [itemId: string];
}>();
const track = ref<HTMLElement>();
const followLatest = ref(true);
const LEADING_EDGE_THRESHOLD = 8;

type VisibleAnchor = Readonly<{ itemId: string; offset: number }>;

function forwardSelect(itemId: string, extend: boolean, toggle: boolean): void {
  emit("select", itemId, extend, toggle);
}

function scrollOffset(element: HTMLElement): number {
  return props.vertical ? element.scrollTop : element.scrollLeft;
}

function setScrollOffset(element: HTMLElement, value: number): void {
  if (props.vertical) element.scrollTop = value;
  else element.scrollLeft = value;
}

function updateFollowLatest(): void {
  const element = track.value;
  if (element === undefined) return;
  followLatest.value = scrollOffset(element) <= LEADING_EDGE_THRESHOLD;
}

function captureVisibleAnchor(element: HTMLElement): VisibleAnchor | undefined {
  const trackBounds = element.getBoundingClientRect();
  for (const card of element.querySelectorAll<HTMLElement>("[data-pb-item-id]")) {
    const bounds = card.getBoundingClientRect();
    const visible = props.vertical
      ? bounds.bottom > trackBounds.top && bounds.top < trackBounds.bottom
      : bounds.right > trackBounds.left && bounds.left < trackBounds.right;
    if (!visible) continue;
    const itemId = card.dataset.pbItemId;
    if (itemId === undefined) continue;
    return {
      itemId,
      offset: props.vertical
        ? bounds.top - trackBounds.top
        : bounds.left - trackBounds.left,
    };
  }
  return undefined;
}

function restoreVisibleAnchor(
  element: HTMLElement,
  anchor: VisibleAnchor,
): boolean {
  const card = [...element.querySelectorAll<HTMLElement>("[data-pb-item-id]")]
    .find((candidate) => candidate.dataset.pbItemId === anchor.itemId);
  if (card === undefined) return false;
  const trackBounds = element.getBoundingClientRect();
  const bounds = card.getBoundingClientRect();
  const nextOffset = props.vertical
    ? bounds.top - trackBounds.top
    : bounds.left - trackBounds.left;
  setScrollOffset(element, scrollOffset(element) + nextOffset - anchor.offset);
  return true;
}

function cardStart(card: HTMLElement): number {
  const bounds = card.getBoundingClientRect();
  return props.vertical ? bounds.top : bounds.left;
}

function cardScrollStep(element: HTMLElement, card: HTMLElement): number {
  const cards = [...element.querySelectorAll<HTMLElement>("[data-pb-item-id]")];
  const index = cards.indexOf(card);
  const neighbor = cards[index + 1] ?? cards[index - 1];
  if (neighbor !== undefined) {
    const measured = Math.abs(cardStart(neighbor) - cardStart(card));
    if (measured > 0) return measured;
  }
  const bounds = card.getBoundingClientRect();
  const gap = Number.parseFloat(getComputedStyle(element).gap) || 0;
  return (props.vertical ? bounds.height : bounds.width) + gap;
}

function focusedCardOutsideViewport(
  element: HTMLElement,
  card: HTMLElement,
  direction: -1 | 1,
): boolean {
  const trackBounds = element.getBoundingClientRect();
  const cardBounds = card.getBoundingClientRect();
  if (props.vertical) {
    return direction < 0
      ? cardBounds.top < trackBounds.top
      : cardBounds.bottom > trackBounds.bottom;
  }
  return direction < 0
    ? cardBounds.left < trackBounds.left
    : cardBounds.right > trackBounds.right;
}

watch(
  () => props.items[0]?.id,
  async (itemId, previousItemId) => {
    if (itemId === undefined || itemId === previousItemId) return;
    const element = track.value;
    const shouldFollow = followLatest.value;
    const anchor = element === undefined || shouldFollow
      ? undefined
      : captureVisibleAnchor(element);
    await nextTick();
    const current = track.value;
    if (current === undefined) return;
    if (shouldFollow) {
      setScrollOffset(current, 0);
      emit("latestVisible", itemId);
      return;
    }
    if (anchor === undefined || !restoreVisibleAnchor(current, anchor)) {
      setScrollOffset(current, 0);
      followLatest.value = true;
      emit("latestVisible", itemId);
    }
  },
);

watch(
  () => props.focusedId,
  async (itemId, previousItemId) => {
    if (itemId === undefined || previousItemId === undefined || itemId === previousItemId) {
      return;
    }
    const previousIndex = props.items.findIndex((item) => item.id === previousItemId);
    const nextIndex = props.items.findIndex((item) => item.id === itemId);
    if (previousIndex < 0 || nextIndex < 0 || previousIndex === nextIndex) return;
    const direction: -1 | 1 = nextIndex < previousIndex ? -1 : 1;
    await nextTick();
    const element = track.value;
    if (element === undefined) return;
    const card = [...element.querySelectorAll<HTMLElement>("[data-pb-item-id]")]
      .find((candidate) => candidate.dataset.pbItemId === itemId);
    if (card === undefined || !focusedCardOutsideViewport(element, card, direction)) {
      return;
    }
    setScrollOffset(
      element,
      scrollOffset(element) + direction * cardScrollStep(element, card),
    );
    updateFollowLatest();
  },
);

onMounted(() => {
  updateFollowLatest();
  const itemId = props.items[0]?.id;
  if (itemId !== undefined && followLatest.value) emit("latestVisible", itemId);
});
</script>

<template>
  <section
    class="timeline"
    :class="{ 'timeline--vertical': props.vertical, 'timeline--compact': props.compact }"
    aria-label="剪贴板时间线"
  >
    <div v-if="props.items.length === 0" class="empty-state" aria-live="polite">
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
      @scroll.passive="updateFollowLatest"
    >
      <PasteCard
        v-for="(item, index) in props.items"
        :key="item.id"
        :item="item"
        :index="index"
        :selected="props.selectedIds.includes(item.id)"
        :vertical="props.vertical"
        :compact="props.compact"
        @select="forwardSelect"
        @paste="emit('paste', $event)"
        @preview="emit('preview', $event)"
      />
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
  display: flex;
  gap: 12px;
  min-height: 150px;
  padding: 4px 3px 12px;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scroll-snap-type: x proximity;
  scrollbar-color: color-mix(in srgb, var(--pb-violet) 30%, transparent) transparent;
  scrollbar-width: thin;
}

.timeline__track > * {
  scroll-snap-align: start;
}

.timeline--vertical {
  min-height: 0;
  padding: 8px 12px 12px;
}

.timeline--vertical .timeline__track {
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 4px 4px 12px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  scroll-snap-type: y proximity;
}

.timeline--vertical.timeline--compact {
  padding: 6px 10px 10px;
}

.timeline--vertical.timeline--compact .timeline__track {
  gap: 8px;
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
