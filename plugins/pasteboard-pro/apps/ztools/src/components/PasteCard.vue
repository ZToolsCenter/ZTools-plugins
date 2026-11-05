<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import type { PasteItem, Pinboard } from "@pasteboard-pro/core";

import {
  loadItemThumbnail,
  observeThumbnailVisibility,
} from "../thumbnail-loader";
import { containContextMenuKeydown } from "../context-menu-keyboard";
import { writeSourceDragData } from "../drag-content";
import { hasPrimaryShortcutModifier, resolveShortcutPlatform } from "../platform-shortcuts";
import "../styles/popover-theme.css";
import { placePopover, type PopupPlacement } from "./popup-position";

import { shelfUiVersionKey } from "../shelf-presentation";
import ModernCardMeta from "./ModernCardMeta.vue";
import ModernCardPreview from "./ModernCardPreview.vue";

const uiVersion = inject(shelfUiVersionKey, ref("classic"));

const props = defineProps<{
  item: PasteItem;
  pinboards: readonly Pinboard[];
  selected: boolean;
  index: number;
  total?: number;
  vertical?: boolean;
  compact?: boolean;
  reorderEnabled?: boolean;
  reorderActive: boolean;
  reorderHidden: boolean;
  reorderShift: number;
}>();

const emit = defineEmits<{
  select: [itemId: string, extend: boolean, toggle: boolean];
  paste: [itemId: string];
  preview: [itemId: string];
  assignPinboard: [value: { pinboardId: string | undefined; itemId: string }];
  createPinboard: [];
  reorderPointerStart: [itemId: string, event: PointerEvent, card: HTMLElement];
}>();
const card = ref<HTMLElement>();
const thumbnailUrl = ref<string>();
const imageDimensions = ref<string>();
const imageWidth = ref<number>();
const imageHeight = ref<number>();
const thumbnailRequested = ref(false);
const platformCapabilities = window.pasteboardPro?.getPlatformCapabilities();
const shortcutPlatform = resolveShortcutPlatform(platformCapabilities?.platform);
const cardDragTitle = computed(() => {
  const isFileSource =
    props.item.kind === "image" || props.item.payload.filePaths !== undefined;
  return isFileSource && platformCapabilities?.supportsNativeFileDrag === false
    ? "当前 ZTools 宿主不支持将图片或文件拖到其他应用"
    : undefined;
});
const contextMenuOpen = ref(false);
const contextMenuPanel = ref<HTMLElement>();
const contextMenuPlacement = ref<PopupPlacement>({ left: 8, top: 8 });
let contextMenuAnchor = { x: 8, y: 8 };
let stopObservingThumbnail: (() => void) | undefined;
const reorderTransformStyle = computed<Record<string, string> | undefined>(() => {
  if (props.reorderShift === 0 || props.reorderHidden) return undefined;
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
function closeContextMenu(restoreFocus = false): void {
  if (!contextMenuOpen.value) return;
  contextMenuOpen.value = false;
  document.removeEventListener("pointerdown", onContextMenuOutsidePointerDown, true);
  window.removeEventListener("keydown", closeContextMenuOnEscape, true);
  window.removeEventListener("resize", updateContextMenuPlacement);
  window.removeEventListener("scroll", updateContextMenuPlacement, true);
  if (restoreFocus) card.value?.focus({ preventScroll: true });
}

function updateContextMenuPlacement(): void {
  const panel = contextMenuPanel.value;
  if (panel === undefined) return;
  contextMenuPlacement.value = placePopover(
    {
      left: contextMenuAnchor.x,
      right: contextMenuAnchor.x,
      top: contextMenuAnchor.y,
      bottom: contextMenuAnchor.y,
    },
    { width: panel.offsetWidth, height: panel.offsetHeight },
    { width: window.innerWidth, height: window.innerHeight },
    { align: "start", margin: 8, gap: 4 },
  );
}

async function openContextMenu(event: MouseEvent): Promise<void> {
  if (!props.selected) emit("select", props.item.id, false, false);
  contextMenuAnchor = { x: event.clientX, y: event.clientY };
  contextMenuOpen.value = true;
  document.addEventListener("pointerdown", onContextMenuOutsidePointerDown, true);
  window.addEventListener("keydown", closeContextMenuOnEscape, true);
  window.addEventListener("resize", updateContextMenuPlacement);
  window.addEventListener("scroll", updateContextMenuPlacement, true);
  await nextTick();
  updateContextMenuPlacement();
  contextMenuPanel.value?.querySelector<HTMLElement>("[role='menuitem']")
    ?.focus({ preventScroll: true });
}

function onContextMenuOutsidePointerDown(event: PointerEvent): void {
  if (event.target instanceof Node && contextMenuPanel.value?.contains(event.target)) return;
  closeContextMenu();
}

function selectCard(event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target : undefined;
  if (target !== undefined && target.closest("[data-pb-reorder-handle]") !== null && props.selected) return;
  emit(
    "select",
    props.item.id,
    event.shiftKey,
    hasPrimaryShortcutModifier(event, shortcutPlatform),
  );
}

function assignToPinboard(pinboardId: string | undefined): void {
  emit("assignPinboard", { pinboardId, itemId: props.item.id });
  closeContextMenu(true);
}

function requestCreatePinboard(): void {
  closeContextMenu();
  emit("createPinboard");
}

function closeContextMenuOnEscape(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  closeContextMenu(true);
}

function handleContextMenuKeydown(event: KeyboardEvent): void {
  containContextMenuKeydown(event, closeContextMenu);
}

function beginCardDrag(event: DragEvent): void {
  const target = event.target instanceof Element ? event.target : undefined;
  const isReorderHandle = target !== undefined &&
    target.closest("[data-pb-reorder-handle]") !== null;
  if (isReorderHandle) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (event.dataTransfer === null) return;

  const isFileSource =
    props.item.kind === "image" || props.item.payload.filePaths !== undefined;
  if (isFileSource) {
    beginNativeFileDrag(event);
    return;
  }
  writeSourceDragData(props.item, event.dataTransfer);
}

function handleCardPointerDown(event: PointerEvent): void {
  const target = event.target instanceof Element ? event.target : undefined;
  const isReorderHandle = target !== undefined &&
    target.closest("[data-pb-reorder-handle]") !== null;
  if (isReorderHandle) {
    if (props.reorderEnabled !== false && card.value !== undefined) {
      event.preventDefault();
      emit("reorderPointerStart", props.item.id, event, card.value);
    }
    return;
  }
  prepareNativeFileDrag();
}

function prepareNativeFileDrag(): void {
  if (props.item.kind !== "image" && props.item.payload.filePaths === undefined) return;
  const preparation = window.pasteboardPro?.prepareNativeFileDrag(props.item.id);
  if (preparation !== undefined) {
    void preparation.catch(() => undefined);
  }
}

function beginNativeFileDrag(event: DragEvent): void {
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

function updateImageDimensions(w: number, h: number): void {
  if (w > 0 && h > 0) {
    imageWidth.value = w;
    imageHeight.value = h;
    imageDimensions.value = `${w}×${h}`;
  }
}

async function loadThumbnail(): Promise<void> {
  if (props.item.kind !== "image") return;
  thumbnailRequested.value = true;
  const thumbnailData = await loadItemThumbnail(
    props.item.id,
    props.item.payload.revision,
  );
  thumbnailUrl.value = thumbnailData?.url;
  if (thumbnailData?.originalWidth && thumbnailData?.originalHeight) {
    updateImageDimensions(thumbnailData.originalWidth, thumbnailData.originalHeight);
  }
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
    imageDimensions.value = undefined;
    imageWidth.value = undefined;
    imageHeight.value = undefined;
    if (thumbnailRequested.value) void loadThumbnail();
  },
);

function handleImageLoad(event: Event) {
  const target = event.currentTarget as HTMLImageElement | null;
  if (!target || !target.naturalWidth || !target.naturalHeight) return;
  updateImageDimensions(target.naturalWidth, target.naturalHeight);
}

// 宽高比与滚动方向：
// 1. 宽高比大于 1（常规横图/截图）：宽度 100%，高度（垂直）平滑滚动浏览；纵向长图同样以宽度 100% 高度滚动浏览
// 2. 超宽全景图（宽高比显著超出容器）：高度 100%，宽度（水平）平滑滚动浏览
const isFitWidth = computed<boolean>(() => {
  if (imageWidth.value && imageHeight.value && imageHeight.value > 0) {
    const ratio = imageWidth.value / imageHeight.value;
    // 容器宽高比约为 3.2。若比例超过 3.0 则为超长宽图（高度100%，横向滚动）
    // 其余常规图与长图均以宽度100%纵向滚动浏览
    return ratio <= 3.0;
  }
  return true;
});

onBeforeUnmount(() => {
  stopObservingThumbnail?.();
  closeContextMenu();
});
</script>

<template>
  <article
    ref="card"
    class="paste-card"
    :class="[`paste-card--${item.kind}`, { 'paste-card--modern': uiVersion === 'modern', 'paste-card--selected': selected, 'paste-card--vertical': vertical, 'paste-card--compact': compact, 'paste-card--dragging': reorderHidden, 'paste-card--reorder-active': reorderActive, 'paste-card--shift-backward': reorderShift < 0, 'paste-card--shift-forward': reorderShift > 0 }]"
    :style="reorderTransformStyle"
    :title="cardDragTitle"
    :aria-selected="selected"
    :aria-posinset="index + 1"
    :aria-setsize="total"
    :data-pb-item-id="item.id"
    role="option"
    tabindex="0"
    draggable="true"
    @click="selectCard"
    @dblclick="emit('paste', item.id)"
    @contextmenu.prevent.stop="openContextMenu"
    @pointerdown="handleCardPointerDown"
    @dragstart="beginCardDrag"
  >
    <ModernCardMeta
      v-if="uiVersion === 'modern'"
      :item="item"
      :index="index"
      :reorder-enabled="reorderEnabled"
      placement="header"
    />
    <header v-else>
      <span class="kind">
        {{ item.kind.replace('_', ' ') }}
        <span v-if="item.kind === 'image' && imageDimensions" class="kind-meta">· {{ imageDimensions }}</span>
      </span>
      <span class="card-tools">
        <button
          v-if="reorderEnabled !== false"
          class="reorder-handle"
          type="button"
          data-pb-reorder-handle
          aria-label="拖动排序"
          draggable="false"
          title="拖动排序"
          @click.stop="selectCard"
        >⠿</button>
        <kbd v-if="index < 9">{{ index + 1 }}</kbd>
      </span>
    </header>
    <ModernCardPreview
      v-if="uiVersion === 'modern' && item.kind !== 'image'"
      :item="item"
      :fallback-text="bodyText"
      :drag-title="cardDragTitle"
    />
    <div v-else-if="item.kind === 'color'" class="color-preview" :style="{ background: item.payload.text }"></div>
    <div
      v-else-if="item.kind === 'image'"
      class="image-preview"
      :class="isFitWidth ? 'image-preview--ratio-gt-1' : 'image-preview--ratio-lt-1'"
      aria-label="图片缩略图"
      draggable="true"
    >
      <img
        v-if="thumbnailUrl"
        :src="thumbnailUrl"
        :alt="item.title ?? '剪贴板图片缩略图'"
        decoding="async"
        draggable="true"
        @load="handleImageLoad"
      />
      <span v-else>IMAGE</span>
    </div>
    <p
      v-else
      :class="{ 'file-drag-source': item.payload.filePaths !== undefined }"
      :draggable="item.payload.filePaths !== undefined"
    >{{ bodyText }}</p>
    <ModernCardMeta v-if="uiVersion === 'modern'" :item="item" :index="index" :image-dimensions="imageDimensions" placement="footer" />
    <footer v-else>
      <strong>{{ item.title ?? item.sourceApp?.name ?? "Untitled" }}</strong>
      <span>{{ item.sourceApp?.name ?? "Unknown app" }}</span>
    </footer>
  </article>
  <Teleport to="body">
    <div
      v-if="contextMenuOpen"
      ref="contextMenuPanel"
      class="pinboard-context-menu glass-surface popover-surface"
      role="menu"
      aria-label="添加到分组"
      :style="{ left: `${contextMenuPlacement.left}px`, top: `${contextMenuPlacement.top}px` }"
      @pointerdown.stop
      @contextmenu.prevent
      @keydown="handleContextMenuKeydown"
    >
      <strong class="popover-caption">添加到分组</strong>
      <span v-if="pinboards.length === 0" class="pinboard-context-menu__empty">
        暂无分组，
        <button type="button" role="menuitem" @click="requestCreatePinboard">去创建</button>
      </span>
      <button
        v-for="pinboard in pinboards"
        :key="pinboard.id"
        type="button"
        role="menuitem"
        class="popover-item"
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
        class="popover-item popover-danger pinboard-context-menu__remove"
        @click="assignToPinboard(undefined)"
      >
        <span>移出分组</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped src="../styles/paste-card.css"></style>
<style scoped src="../styles/modern-card.css"></style>
