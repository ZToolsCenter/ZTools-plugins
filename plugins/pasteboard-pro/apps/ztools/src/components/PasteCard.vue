<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import type { PasteItem, Pinboard } from "@pasteboard-pro/core";

import {
  loadItemThumbnail,
  observeThumbnailVisibility,
} from "../thumbnail-loader";
import { containContextMenuKeydown } from "../context-menu-keyboard";
import { writeSourceDragData } from "../drag-content";
import { LIST_REORDER_MIME } from "../list-order";
import { hasPrimaryShortcutModifier, resolveShortcutPlatform } from "../platform-shortcuts";

const props = defineProps<{
  item: PasteItem;
  pinboards: readonly Pinboard[];
  selected: boolean;
  index: number;
  vertical?: boolean;
  compact?: boolean;
  reorderEnabled?: boolean;
  reorderActive: boolean;
  reorderHidden: boolean;
  reorderItemIds: readonly string[];
  reorderShift: number;
}>();

const emit = defineEmits<{
  select: [itemId: string, extend: boolean, toggle: boolean];
  paste: [itemId: string];
  preview: [itemId: string];
  assignPinboard: [value: { pinboardId: string | undefined; itemId: string }];
  createPinboard: [];
  reorderDragStart: [itemId: string];
  reorderDragEnd: [];
}>();
const card = ref<HTMLElement>();
const thumbnailUrl = ref<string>();
const thumbnailRequested = ref(false);
const reorderDragging = ref(false);
const shortcutPlatform = resolveShortcutPlatform(
  window.pasteboardPro?.getPlatformCapabilities().platform,
);
const contextMenu = ref<{ x: number; y: number }>();
let stopObservingThumbnail: (() => void) | undefined;
let reorderDragPreview: HTMLElement | undefined;
const reorderTransformStyle = computed<Record<string, string> | undefined>(() => {
  if (props.reorderShift === 0 || props.reorderHidden || reorderDragging.value) return undefined;
  const gap = props.vertical && props.compact ? 8 : 12;
  const percent = props.reorderShift * 100;
  const gapOffset = props.reorderShift * gap;
  const distance = gapOffset < 0
    ? `${percent}% - ${Math.abs(gapOffset)}px`
    : `${percent}% + ${gapOffset}px`;
  const transform = props.vertical
    ? `translateY(calc(${distance}))`
    : `translateX(calc(${distance}))`;
  return { "--pb-reorder-transform": transform };
});

function closeContextMenu(): void {
  document.removeEventListener("pointerdown", closeContextMenu);
  window.removeEventListener("keydown", closeContextMenuOnEscape);
  contextMenu.value = undefined;
}

function openContextMenu(event: MouseEvent): void {
  if (!props.selected) emit("select", props.item.id, false, false);
  contextMenu.value = {
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 208)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 280)),
  };
  document.addEventListener("pointerdown", closeContextMenu);
  window.addEventListener("keydown", closeContextMenuOnEscape);
}

function selectCard(event: MouseEvent): void {
  emit(
    "select",
    props.item.id,
    event.shiftKey,
    hasPrimaryShortcutModifier(event, shortcutPlatform),
  );
}

function assignToPinboard(pinboardId: string | undefined): void {
  emit("assignPinboard", { pinboardId, itemId: props.item.id });
  closeContextMenu();
}

function requestCreatePinboard(): void {
  closeContextMenu();
  emit("createPinboard");
}

function closeContextMenuOnEscape(event: KeyboardEvent): void {
  if (event.key === "Escape") closeContextMenu();
}

function handleContextMenuKeydown(event: KeyboardEvent): void {
  containContextMenuKeydown(event, closeContextMenu);
}

function beginSourceDrag(event: DragEvent): void {
  if (props.item.kind === "image" || props.item.payload.filePaths !== undefined) {
    beginNativeFileDrag(event);
    return;
  }
  if (event.dataTransfer !== null) writeSourceDragData(props.item, event.dataTransfer);
}

function removeReorderDragPreview(): void {
  reorderDragPreview?.remove();
  reorderDragPreview = undefined;
}

function reorderPreviewCards(): readonly HTMLElement[] {
  const cards = [...document.querySelectorAll<HTMLElement>("[data-pb-item-id]")];
  return props.reorderItemIds.flatMap((itemId) => {
    const sourceCard = cards.find((candidate) => candidate.dataset.pbItemId === itemId);
    return sourceCard === undefined ? [] : [sourceCard];
  });
}

function installReorderDragPreview(event: DragEvent): void {
  const source = event.currentTarget;
  if (!(source instanceof HTMLElement) || event.dataTransfer === null) return;
  removeReorderDragPreview();
  const sourceBounds = source.getBoundingClientRect();
  const sourceCards = reorderPreviewCards();
  if (sourceCards.length === 0) return;

  const gap = sourceCards.length > 1 ? 10 : 0;
  const maximumWidth = Math.max(320, Math.min(window.innerWidth * 0.86, 920));
  const unscaledWidth = sourceCards.reduce(
    (width, sourceCard) => width + sourceCard.getBoundingClientRect().width,
    gap * Math.max(0, sourceCards.length - 1),
  );
  const scale = Math.min(0.96, maximumWidth / Math.max(1, unscaledWidth));
  const scaledGap = gap * scale;
  const preview = document.createElement("div");
  preview.className = "paste-card-drag-group";
  preview.dataset.pbDragPreviewCount = String(sourceCards.length);
  preview.setAttribute("aria-hidden", "true");
  Object.assign(preview.style, {
    position: "fixed",
    zIndex: "10000",
    top: "-9999px",
    left: "-9999px",
    display: "flex",
    gap: `${scaledGap}px`,
    alignItems: "flex-start",
    pointerEvents: "none",
  });

  let sourceOffset = 0;
  let maximumHeight = 0;
  const sourceIndex = sourceCards.findIndex((candidate) => candidate === source);
  sourceCards.forEach((sourceCard, index) => {
    const bounds = sourceCard.getBoundingClientRect();
    const slot = document.createElement("div");
    const slotWidth = bounds.width * scale;
    const slotHeight = bounds.height * scale;
    Object.assign(slot.style, {
      position: "relative",
      flex: `0 0 ${slotWidth}px`,
      width: `${slotWidth}px`,
      height: `${slotHeight}px`,
      zIndex: String(sourceCards.length - index),
    });

    const cardPreview = sourceCard.cloneNode(true) as HTMLElement;
    cardPreview.classList.remove(
      "paste-card--dragging",
      "paste-card--reorder-active",
      "paste-card--shift-backward",
      "paste-card--shift-forward",
    );
    cardPreview.classList.add("paste-card--drag-preview");
    cardPreview.dataset.pbDragPreviewIndex = String(index);
    cardPreview.setAttribute("aria-hidden", "true");
    cardPreview.removeAttribute("tabindex");
    cardPreview.setAttribute("draggable", "false");
    Object.assign(cardPreview.style, {
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
      transformOrigin: "top left",
    });
    cardPreview.style.setProperty(
      "--pb-drag-preview-yaw",
      `${index % 2 === 0 ? -7 : 7}deg`,
    );
    cardPreview.style.setProperty("--pb-drag-preview-scale", String(scale));
    slot.append(cardPreview);
    preview.append(slot);

    if (sourceCard === source) {
      sourceOffset += Math.max(
        0,
        Math.min(bounds.width, event.clientX - sourceBounds.left),
      ) * scale;
    } else if (index < sourceIndex) {
      sourceOffset += slotWidth + scaledGap;
    }
    maximumHeight = Math.max(maximumHeight, slotHeight);
  });
  preview.style.height = `${maximumHeight}px`;

  document.body.append(preview);
  reorderDragPreview = preview;
  const offsetY = Math.max(
    0,
    Math.min(sourceBounds.height, event.clientY - sourceBounds.top),
  ) * scale;
  event.dataTransfer.setDragImage(preview, sourceOffset, offsetY);
}

function beginReorderDrag(event: DragEvent): void {
  if (event.dataTransfer === null || props.reorderEnabled === false) return;
  writeSourceDragData(props.item, event.dataTransfer);
  event.dataTransfer.setData(LIST_REORDER_MIME, JSON.stringify(props.reorderItemIds));
  event.dataTransfer.effectAllowed = "copyMove";
  reorderDragging.value = true;
  installReorderDragPreview(event);
  emit("reorderDragStart", props.item.id);
}

function finishReorderDrag(): void {
  reorderDragging.value = false;
  removeReorderDragPreview();
  emit("reorderDragEnd");
}

function prepareNativeFileDrag(): void {
  if (props.item.kind !== "image" && props.item.payload.filePaths === undefined) return;
  const preparation = window.pasteboardPro?.prepareNativeFileDrag(props.item.id);
  if (preparation !== undefined) {
    void preparation.catch(() => undefined);
  }
}

function beginNativeFileDrag(event: DragEvent): void {
  // Stop nested image/file drag events from reaching the card reorder handler.
  event.stopPropagation();
  const started = window.pasteboardPro?.startNativeFileDrag(props.item.id) ?? false;
  if (started) {
    event.preventDefault();
    return;
  }
  // ZTools 2.4–3.1 has no startDrag API. Preserve the browser data-transfer
  // payload so those hosts still support in-plugin/source dragging.
  if (event.dataTransfer !== null) {
    writeSourceDragData(props.item, event.dataTransfer);
  }
}

const bodyText = computed(() => {
  if (props.item.payload.text !== undefined) return props.item.payload.text;
  if (props.item.payload.filePaths !== undefined) {
    return props.item.payload.filePaths.map((path) => path.split("/").pop() ?? path).join("\n");
  }
  if (props.item.ocrText !== undefined) return props.item.ocrText;
  return props.item.payload.mediaType ?? props.item.kind;
});

async function loadThumbnail(): Promise<void> {
  if (props.item.kind !== "image") return;
  thumbnailRequested.value = true;
  thumbnailUrl.value = await loadItemThumbnail(
    props.item.id,
    props.item.payload.revision,
  );
  prepareNativeFileDrag();
}

onMounted(() => {
  if (props.item.kind !== "image" || card.value === undefined) return;
  stopObservingThumbnail = observeThumbnailVisibility(card.value, () => {
    void loadThumbnail();
  });
});

watch(
  () => props.item.payload.revision,
  () => {
    thumbnailUrl.value = undefined;
    if (thumbnailRequested.value) void loadThumbnail();
  },
);

onBeforeUnmount(() => {
  stopObservingThumbnail?.();
  removeReorderDragPreview();
  closeContextMenu();
});
</script>

<template>
  <article
    ref="card"
    class="paste-card"
    :class="[`paste-card--${item.kind}`, { 'paste-card--selected': selected, 'paste-card--vertical': vertical, 'paste-card--compact': compact, 'paste-card--dragging': reorderDragging || reorderHidden, 'paste-card--reorder-active': reorderActive, 'paste-card--shift-backward': reorderShift < 0, 'paste-card--shift-forward': reorderShift > 0 }]"
    :style="reorderTransformStyle"
    :aria-selected="selected"
    :data-pb-item-id="item.id"
    role="option"
    tabindex="0"
    :draggable="reorderEnabled !== false"
    @click="selectCard"
    @dblclick="emit('paste', item.id)"
    @contextmenu.prevent.stop="openContextMenu"
    @dragstart="beginReorderDrag"
    @dragend="finishReorderDrag"
  >
    <header>
      <span class="kind">{{ item.kind.replace('_', ' ') }}</span>
      <span class="card-tools">
        <span
          v-if="reorderEnabled !== false"
          class="reorder-indicator"
          aria-hidden="true"
          title="拖动排序"
        >⠿</span>
        <kbd v-if="index < 9">{{ index + 1 }}</kbd>
      </span>
    </header>
    <div v-if="item.kind === 'color'" class="color-preview" :style="{ background: item.payload.text }"></div>
    <div v-else-if="item.kind === 'image'" class="image-preview" aria-label="图片缩略图" draggable="true" @pointerdown="prepareNativeFileDrag" @dragstart="beginNativeFileDrag">
      <img
        v-if="thumbnailUrl"
        :src="thumbnailUrl"
        :alt="item.title ?? '剪贴板图片缩略图'"
        decoding="async"
        draggable="true"
        @pointerdown="prepareNativeFileDrag"
        @dragstart="beginNativeFileDrag"
      />
      <span v-else>IMAGE</span>
    </div>
    <p
      v-else
      :class="{ 'file-drag-source': item.payload.filePaths !== undefined }"
      :draggable="item.payload.filePaths !== undefined"
      @pointerdown="prepareNativeFileDrag"
      @dragstart.stop="beginSourceDrag"
    >{{ bodyText }}</p>
    <footer>
      <strong>{{ item.title ?? item.sourceApp?.name ?? "Untitled" }}</strong>
      <span>{{ item.sourceApp?.name ?? "Unknown app" }}</span>
    </footer>
  </article>
  <Teleport to="body">
    <div
      v-if="contextMenu"
      class="pinboard-context-menu glass-surface"
      role="menu"
      aria-label="添加到分组"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      @pointerdown.stop
      @contextmenu.prevent
      @keydown="handleContextMenuKeydown"
    >
      <strong>添加到分组</strong>
      <span v-if="pinboards.length === 0" class="pinboard-context-menu__empty">
        暂无分组，
        <button type="button" role="menuitem" @click="requestCreatePinboard">去创建</button>
      </span>
      <button
        v-for="pinboard in pinboards"
        :key="pinboard.id"
        type="button"
        role="menuitem"
        :class="{ 'pinboard-context-menu__current': item.pinboardId === pinboard.id }"
        @click="assignToPinboard(pinboard.id)"
      >
        <i :style="{ background: pinboard.color }" aria-hidden="true"></i>
        <span>{{ pinboard.name }}</span>
        <small v-if="item.pinboardId === pinboard.id">当前</small>
      </button>
      <button
        v-if="item.pinboardId !== undefined"
        type="button"
        role="menuitem"
        class="pinboard-context-menu__remove"
        @click="assignToPinboard(undefined)"
      >
        <span>移出分组</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.paste-card {
  position: relative;
  display: grid;
  flex: 0 0 var(--pb-card-width);
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: var(--pb-card-width);
  height: 142px;
  padding: 11px;
  overflow: hidden;
  border: 1px solid var(--pb-line);
  border-radius: 18px;
  background: color-mix(in srgb, var(--pb-glass-strong) 82%, transparent);
  box-shadow: 0 8px 24px color-mix(in srgb, var(--pb-shadow) 45%, transparent);
  cursor: default;
  outline: 0;
  transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
  contain: layout paint style;
  content-visibility: auto;
  contain-intrinsic-size: var(--pb-card-width) 142px;
}

.paste-card[draggable="true"] {
  cursor: grab;
  user-select: none;
}

.paste-card[draggable="true"]:active {
  cursor: grabbing;
}

.paste-card.paste-card--dragging {
  opacity: 0;
  transform: none;
}

.paste-card.paste-card--drag-preview {
  position: absolute !important;
  inset: 0 auto auto 0 !important;
  margin: 0 !important;
  opacity: .98;
  box-shadow:
    22px 28px 44px rgba(20, 14, 44, .34),
    0 12px 24px rgba(20, 14, 44, .2),
    inset 0 1px 0 rgba(255, 255, 255, .78);
  pointer-events: none;
  transform:
    perspective(900px)
    rotateX(7deg)
    rotateY(var(--pb-drag-preview-yaw, -7deg))
    translateZ(28px)
    scale(var(--pb-drag-preview-scale, .96));
  transform-origin: center;
  contain: none;
  content-visibility: visible;
}

.paste-card.paste-card--shift-backward {
  transform: var(--pb-reorder-transform);
}

.paste-card.paste-card--shift-forward {
  transform: var(--pb-reorder-transform);
}

.paste-card:not(.paste-card--reorder-active):hover {
  transform: translateY(-2px);
}

.pinboard-context-menu {
  position: fixed;
  z-index: 100;
  display: grid;
  width: 200px;
  max-height: min(272px, calc(100vh - 16px));
  padding: 7px;
  overflow-y: auto;
  border: 1px solid var(--pb-line);
  border-radius: 13px;
  background: color-mix(in srgb, var(--pb-glass-strong) 96%, transparent);
  box-shadow: 0 18px 48px var(--pb-shadow);
}

.pinboard-context-menu > strong,
.pinboard-context-menu__empty {
  padding: 7px 9px;
  color: var(--pb-muted);
  font-size: 10px;
}

.pinboard-context-menu__empty > button {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--pb-violet);
  cursor: pointer;
  font: inherit;
  font-weight: 750;
}

.pinboard-context-menu__empty > button:hover,
.pinboard-context-menu__empty > button:focus-visible {
  text-decoration: underline;
  outline: 0;
}

.pinboard-context-menu > button {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  min-height: 34px;
  padding: 0 9px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--pb-ink);
  cursor: pointer;
  text-align: left;
}

.pinboard-context-menu > button:hover,
.pinboard-context-menu > button:focus-visible,
.pinboard-context-menu__current {
  background: color-mix(in srgb, var(--pb-violet) 12%, transparent) !important;
  outline: 0;
}

.pinboard-context-menu > button i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.pinboard-context-menu > button span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pinboard-context-menu > button small {
  color: var(--pb-violet);
  font-size: 9px;
}

.pinboard-context-menu__remove {
  grid-template-columns: 1fr !important;
  margin-top: 4px;
  border-top: 1px solid var(--pb-line) !important;
  border-radius: 0 0 9px 9px !important;
  color: var(--pb-muted) !important;
}

.paste-card--vertical {
  flex: 0 0 auto;
  width: 100%;
}

.paste-card--vertical.paste-card--compact {
  height: 108px;
  padding: 9px;
  border-radius: 15px;
  contain-intrinsic-size: 100% 108px;
}

.paste-card--vertical.paste-card--compact p {
  margin: 6px 0;
  font-size: 11px;
  line-height: 1.35;
  -webkit-line-clamp: 2;
}

.paste-card--vertical.paste-card--compact .color-preview,
.paste-card--vertical.paste-card--compact .image-preview {
  min-height: 38px;
  margin: 5px 0;
  border-radius: 9px;
}

.paste-card--vertical.paste-card--compact .image-preview img {
  min-height: 38px;
}

.paste-card--vertical.paste-card--compact kbd {
  width: 16px;
  height: 16px;
}

.paste-card--selected,
.paste-card:focus-visible {
  border-color: color-mix(in srgb, var(--pb-violet) 72%, transparent);
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--pb-violet) 15%, transparent),
    0 12px 28px color-mix(in srgb, var(--pb-shadow) 55%, transparent);
}

header,
footer {
  display: flex;
  gap: 8px;
  align-items: center;
}

header {
  justify-content: space-between;
}

.card-tools {
  display: inline-flex;
  gap: 5px;
  align-items: center;
}

.reorder-indicator {
  display: grid;
  width: 18px;
  height: 18px;
  color: var(--pb-muted);
  font: 13px/1 system-ui, sans-serif;
  opacity: .55;
  pointer-events: none;
  place-items: center;
}

.paste-card:hover .reorder-indicator,
.paste-card:focus-visible .reorder-indicator {
  color: var(--pb-violet);
  opacity: 1;
}

.kind {
  color: var(--pb-violet);
  font-size: 9px;
  font-weight: 760;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

kbd {
  display: grid;
  width: 18px;
  height: 18px;
  border: 1px solid var(--pb-line);
  border-radius: 6px;
  color: var(--pb-muted);
  font-size: 9px;
  place-items: center;
}

p {
  display: -webkit-box;
  margin: 10px 0;
  overflow: hidden;
  color: var(--pb-ink);
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.color-preview,
.image-preview {
  min-height: 62px;
  margin: 8px 0;
  border-radius: 11px;
}

.image-preview {
  display: grid;
  background:
    radial-gradient(circle at 28% 30%, rgba(255, 255, 255, 0.7), transparent 30%),
    linear-gradient(135deg, #8e82e8, #423c72);
  color: rgba(255, 255, 255, 0.72);
  font-size: 9px;
  font-weight: 750;
  letter-spacing: 0.18em;
  place-items: center;
}

.image-preview img {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 62px;
  cursor: grab;
  object-fit: cover;
}

.image-preview img:active {
  cursor: grabbing;
}

.file-drag-source {
  cursor: grab;
}

.file-drag-source:active {
  cursor: grabbing;
}

footer {
  min-width: 0;
  justify-content: space-between;
  color: var(--pb-muted);
  font-size: 9px;
}

footer strong,
footer span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

footer strong {
  color: var(--pb-ink);
  font-size: 10px;
}

@media (prefers-reduced-motion: reduce) {
  .paste-card {
    transition: none;
  }

  .paste-card.paste-card--dragging,
  .paste-card.paste-card--drag-preview,
  .paste-card.paste-card--shift-backward,
  .paste-card.paste-card--shift-forward {
    transform: none;
  }
}
</style>
