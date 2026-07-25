<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import type { PasteItem, Pinboard } from "@pasteboard-pro/core";

import {
  loadItemThumbnail,
  observeThumbnailVisibility,
} from "../thumbnail-loader";

const props = defineProps<{
  item: PasteItem;
  pinboards: readonly Pinboard[];
  selected: boolean;
  index: number;
  vertical?: boolean;
  compact?: boolean;
}>();

const emit = defineEmits<{
  select: [itemId: string, extend: boolean, toggle: boolean];
  paste: [itemId: string];
  preview: [itemId: string];
  assignPinboard: [value: { pinboardId: string | undefined; itemId: string }];
}>();
const card = ref<HTMLElement>();
const thumbnailUrl = ref<string>();
const thumbnailRequested = ref(false);
const contextMenu = ref<{ x: number; y: number }>();
let stopObservingThumbnail: (() => void) | undefined;

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

function assignToPinboard(pinboardId: string | undefined): void {
  emit("assignPinboard", { pinboardId, itemId: props.item.id });
  closeContextMenu();
}

function closeContextMenuOnEscape(event: KeyboardEvent): void {
  if (event.key === "Escape") closeContextMenu();
}

function beginDrag(event: DragEvent): void {
  event.dataTransfer?.setData("application/x-pasteboard-pro-item", props.item.id);
  if (event.dataTransfer !== null) {
    event.dataTransfer.effectAllowed = "move";
  }
}

function prepareNativeFileDrag(): void {
  if (props.item.kind !== "image" && props.item.payload.filePaths === undefined) return;
  const preparation = window.pasteboardPro?.prepareNativeFileDrag(props.item.id);
  if (preparation !== undefined) {
    void preparation.catch(() => undefined);
  }
}

function beginNativeFileDrag(event: DragEvent): void {
  event.dataTransfer?.setData("application/x-pasteboard-pro-item", props.item.id);
  if (event.dataTransfer !== null) {
    event.dataTransfer.effectAllowed = "copy";
  }
  if (window.pasteboardPro?.startNativeFileDrag(props.item.id) === true) {
    event.stopPropagation();
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
  closeContextMenu();
});
</script>

<template>
  <article
    ref="card"
    class="paste-card"
    :class="[`paste-card--${item.kind}`, { 'paste-card--selected': selected, 'paste-card--vertical': vertical, 'paste-card--compact': compact }]"
    :aria-selected="selected"
    :data-pb-item-id="item.id"
    role="option"
    tabindex="0"
    draggable="true"
    @dragstart="beginDrag"
    @click="emit('select', item.id, $event.shiftKey, $event.metaKey)"
    @dblclick="emit('paste', item.id)"
    @contextmenu.prevent.stop="openContextMenu"
    @keydown.enter="emit('paste', item.id)"
    @keydown.space.prevent="emit('preview', item.id)"
  >
    <header>
      <span class="kind">{{ item.kind.replace('_', ' ') }}</span>
      <kbd v-if="index < 9">{{ index + 1 }}</kbd>
    </header>
    <div v-if="item.kind === 'color'" class="color-preview" :style="{ background: item.payload.text }"></div>
    <div v-else-if="item.kind === 'image'" class="image-preview" aria-label="图片缩略图">
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
      @dragstart="beginNativeFileDrag"
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
    >
      <strong>添加到分组</strong>
      <span v-if="pinboards.length === 0" class="pinboard-context-menu__empty">暂无分组</span>
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

.paste-card:hover {
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
}
</style>
