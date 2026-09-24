<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, watch } from "vue";
import { ZoomIn, ZoomOut } from "@lucide/vue";

const props = defineProps<{
  source: string;
}>();

const emit = defineEmits<{
  "context-menu": [event: MouseEvent];
}>();

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.25;

const shellRef = shallowRef<HTMLElement | null>(null);
const imageNaturalSize = shallowRef<{ width: number; height: number } | null>(null);
const viewportSize = shallowRef<{ width: number; height: number } | null>(null);
const zoomLevel = shallowRef(1);
const isPanning = shallowRef(false);
const hasOverflow = shallowRef(false);

const isSvg = computed(() => /\.svg(?:$|[?#])/i.test(props.source));
const imageSizeLabel = computed(() => {
  if (isSvg.value || !imageNaturalSize.value) return "";
  return `${imageNaturalSize.value.width} × ${imageNaturalSize.value.height}`;
});

const fitSize = computed(() => {
  if (!imageNaturalSize.value || !viewportSize.value) return null;
  const nw = imageNaturalSize.value.width;
  const nh = imageNaturalSize.value.height;
  if (!nw || !nh) return null;

  const vw = Math.max(viewportSize.value.width, 20);
  const vh = Math.max(viewportSize.value.height, 20);

  const scale = Math.min(vw / nw, vh / nh, 1);
  return {
    width: Math.max(Math.round(nw * scale), 1),
    height: Math.max(Math.round(nh * scale), 1),
    naturalScale: nw > 0 && Math.round(nw * scale) > 0 ? nw / Math.round(nw * scale) : 2,
  };
});

const imageStyle = computed(() => {
  if (zoomLevel.value === 1 || !imageNaturalSize.value || !viewportSize.value) {
    return {
      maxWidth: "100%",
      maxHeight: "100%",
      width: "auto",
      height: "auto",
    };
  }

  const nw = imageNaturalSize.value.width;
  const nh = imageNaturalSize.value.height;
  const vw = Math.max(viewportSize.value.width, 20);
  const vh = Math.max(viewportSize.value.height, 20);

  const baseScale = Math.min(vw / nw, vh / nh, 1);
  const currentWidth = Math.max(Math.round(nw * baseScale * zoomLevel.value), 1);
  const currentHeight = Math.max(Math.round(nh * baseScale * zoomLevel.value), 1);

  return {
    width: `${currentWidth}px`,
    height: `${currentHeight}px`,
    maxWidth: "none",
    maxHeight: "none",
  };
});

function checkOverflow() {
  if (!shellRef.value) {
    hasOverflow.value = false;
    return;
  }
  hasOverflow.value =
    shellRef.value.scrollHeight > shellRef.value.clientHeight + 1 ||
    shellRef.value.scrollWidth > shellRef.value.clientWidth + 1;
}

function updateViewportSize() {
  if (shellRef.value) {
    viewportSize.value = {
      width: shellRef.value.clientWidth,
      height: shellRef.value.clientHeight,
    };
    void nextTick(checkOverflow);
  }
}

watch(
  () => props.source,
  () => {
    imageNaturalSize.value = null;
    zoomLevel.value = 1;
    updateViewportSize();
  },
);

function centerScroll() {
  if (!shellRef.value) return;
  const maxScrollX = shellRef.value.scrollWidth - shellRef.value.clientWidth;
  const maxScrollY = shellRef.value.scrollHeight - shellRef.value.clientHeight;
  if (maxScrollX > 0) {
    shellRef.value.scrollLeft = maxScrollX / 2;
  }
  if (maxScrollY > 0) {
    shellRef.value.scrollTop = maxScrollY / 2;
  }
}

watch(zoomLevel, (newZoom, oldZoom) => {
  void nextTick(() => {
    checkOverflow();
    if (newZoom > 1 && oldZoom === 1) {
      centerScroll();
    }
  });
});

function updateImageSize(event: Event) {
  if (!(event.target instanceof HTMLImageElement)) return;
  imageNaturalSize.value = {
    width: event.target.naturalWidth,
    height: event.target.naturalHeight,
  };
  updateViewportSize();
}

function zoomIn() {
  zoomLevel.value = Math.min(MAX_ZOOM, Math.round((zoomLevel.value + ZOOM_STEP) * 100) / 100);
}

function zoomOut() {
  zoomLevel.value = Math.max(MIN_ZOOM, Math.round((zoomLevel.value - ZOOM_STEP) * 100) / 100);
}

function resetZoom() {
  zoomLevel.value = 1;
  if (shellRef.value) {
    shellRef.value.scrollLeft = 0;
    shellRef.value.scrollTop = 0;
  }
}

function handleDoubleClick() {
  if (zoomLevel.value === 1) {
    const targetScale = fitSize.value?.naturalScale ?? 2;
    zoomLevel.value = Math.min(MAX_ZOOM, Math.max(1.5, Math.round(targetScale * 10) / 10));
  } else {
    resetZoom();
  }
}

function handleWheel(event: WheelEvent) {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  if (event.deltaY < 0) {
    zoomIn();
  } else if (event.deltaY > 0) {
    zoomOut();
  }
}

let isDragging = false;
let startX = 0;
let startY = 0;
let scrollLeftStart = 0;
let scrollTopStart = 0;

function handleMouseDown(event: MouseEvent) {
  if (event.button !== 0 || !shellRef.value) return;
  if (zoomLevel.value === 1) return;

  checkOverflow();
  if (!hasOverflow.value) return;

  isDragging = true;
  isPanning.value = true;
  startX = event.clientX;
  startY = event.clientY;
  scrollLeftStart = shellRef.value.scrollLeft;
  scrollTopStart = shellRef.value.scrollTop;
  window.addEventListener("mousemove", handleMouseMove);
  window.addEventListener("mouseup", handleMouseUp);
}

function handleImageDragStart(event: DragEvent) {
  if (zoomLevel.value !== 1) {
    event.preventDefault();
  }
}

function handleMouseMove(event: MouseEvent) {
  if (!isDragging || !shellRef.value) return;
  event.preventDefault();
  const dx = event.clientX - startX;
  const dy = event.clientY - startY;
  shellRef.value.scrollLeft = scrollLeftStart - dx;
  shellRef.value.scrollTop = scrollTopStart - dy;
}

function handleMouseUp() {
  isDragging = false;
  isPanning.value = false;
  window.removeEventListener("mousemove", handleMouseMove);
  window.removeEventListener("mouseup", handleMouseUp);
}

let resizeObserver: ResizeObserver | undefined;

onMounted(() => {
  updateViewportSize();
  if (shellRef.value && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      updateViewportSize();
    });
    resizeObserver.observe(shellRef.value);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  window.removeEventListener("mousemove", handleMouseMove);
  window.removeEventListener("mouseup", handleMouseUp);
});
</script>

<template>
  <div class="image-preview" @contextmenu.prevent.stop="emit('context-menu', $event)">
    <header class="image-info-bar">
      <span class="image-size-label">{{ imageSizeLabel }}</span>
      <div class="image-zoom-controls">
        <button
          type="button"
          class="zoom-btn"
          title="缩小 (Ctrl+滚轮下)"
          tabindex="-1"
          :disabled="zoomLevel <= MIN_ZOOM"
          @mousedown.left.prevent
          @click="zoomOut"
        >
          <ZoomOut :size="13" :stroke-width="2" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="zoom-value-btn"
          title="重置缩放 (100% 适应窗口)"
          tabindex="-1"
          @mousedown.left.prevent
          @click="resetZoom"
        >
          {{ Math.round(zoomLevel * 100) }}%
        </button>
        <button
          type="button"
          class="zoom-btn"
          title="放大 (Ctrl+滚轮上)"
          tabindex="-1"
          :disabled="zoomLevel >= MAX_ZOOM"
          @mousedown.left.prevent
          @click="zoomIn"
        >
          <ZoomIn :size="13" :stroke-width="2" aria-hidden="true" />
        </button>
      </div>
    </header>
    <div
      ref="shellRef"
      class="preview-media-shell"
      :class="{
        'has-overflow': hasOverflow && zoomLevel !== 1,
        'is-panning': isPanning,
        'is-zoomed': zoomLevel !== 1,
      }"
      @wheel="handleWheel"
      @mousedown="handleMouseDown"
      @dblclick="handleDoubleClick"
    >
      <div class="image-stage-wrap">
        <img
          class="preview-image"
          :class="{ 'svg-image': isSvg }"
          :src="source"
          :style="imageStyle"
          alt=""
          :draggable="zoomLevel === 1"
          @dragstart="handleImageDragStart"
          @load="updateImageSize"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.image-preview {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  background: #0f1012;
  user-select: auto;
}

.image-info-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  height: 30px;
  padding: 0 34px 0 12px;
  color: #c3c8cf;
  border-bottom: 1px solid #282a2d;
  font-size: 12px;
  user-select: none;
}

.image-size-label {
  font-family: Consolas, "Cascadia Mono", monospace;
}

.image-zoom-controls {
  display: flex;
  align-items: center;
  gap: 2px;
}

.zoom-btn,
.zoom-value-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 22px;
  box-sizing: border-box;
  padding: 0 6px;
  color: #c3c8cf;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  font-family: Consolas, "Cascadia Mono", monospace;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
}

.zoom-btn {
  width: 22px;
  padding: 0;
}

.zoom-value-btn {
  min-width: 44px;
  font-weight: 500;
}

.zoom-btn:hover:not(:disabled),
.zoom-value-btn:hover {
  color: #ffffff;
  background: #2b2e33;
  border-color: #454950;
}

.zoom-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.preview-media-shell {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  padding: 0;
  overflow: hidden;
}

.preview-media-shell.is-zoomed {
  overflow: auto;
  display: block;
  user-select: none;
}

.preview-media-shell.has-overflow,
.preview-media-shell.is-zoomed {
  cursor: grab;
}

.preview-media-shell.is-panning,
.preview-media-shell.is-panning * {
  cursor: grabbing !important;
  user-select: none;
}

.image-stage-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  margin: auto;
}

.preview-media-shell.is-zoomed .image-stage-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: max-content;
  height: max-content;
  min-width: 100%;
  min-height: 100%;
  padding: 24px;
  box-sizing: border-box;
}

.preview-image {
  display: block;
  box-sizing: border-box;
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  flex-shrink: 0;
  user-select: auto;
  -webkit-user-drag: auto;
  cursor: default;
  background-color: #ffffff;
  background-image: conic-gradient(
    #e5e5e5 0 25%,
    #ffffff 25% 50%,
    #e5e5e5 50% 75%,
    #ffffff 75% 100%
  );
  background-size: 16px 16px;
  box-shadow: 0 2px 14px rgb(0 0 0 / 18%);
}

.preview-media-shell.is-zoomed .preview-image {
  user-select: none;
  -webkit-user-drag: none;
  cursor: grab;
}

.svg-image {
  max-width: min(100%, 640px);
  max-height: min(100%, 640px);
}

@media (prefers-color-scheme: light) {
  .image-preview {
    background: #f8fafc;
  }

  .image-info-bar {
    color: #667085;
    border-bottom-color: #d9dee7;
  }

  .zoom-btn,
  .zoom-value-btn {
    color: #4f5b6a;
  }

  .zoom-btn:hover:not(:disabled),
  .zoom-value-btn:hover {
    color: #111827;
    background: #eef2f7;
    border-color: #cbd5e1;
  }
}
</style>
