<script setup lang="ts">
import { computed, ref, type CSSProperties } from 'vue';
import type { WorkspaceDocument } from '../../stores/workspaceEditor';

const { document } = defineProps<{
  document: WorkspaceDocument;
}>();

const zoom = ref(1);
const fit = ref(true);
const width = ref<number | null>(null);
const height = ref<number | null>(null);

const imageStyle = computed<CSSProperties>(() => {
  if (fit.value) return { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' };
  // 非 Fit：100% = 图片 natural 像素，而不是相对容器宽度。
  if (width.value && height.value) {
    return {
      width: `${Math.round(width.value * zoom.value)}px`,
      height: `${Math.round(height.value * zoom.value)}px`,
      maxWidth: 'none',
      maxHeight: 'none',
    };
  }
  return { maxWidth: 'none', maxHeight: 'none' };
});

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function setZoom(next: number): void {
  fit.value = false;
  zoom.value = Math.min(4, Math.max(0.1, next));
}

function onImageLoad(event: Event): void {
  const image = event.target as HTMLImageElement;
  width.value = image.naturalWidth;
  height.value = image.naturalHeight;
}
</script>

<template>
  <div class="image-document flex h-full min-h-0 flex-col">
    <div class="image-document-toolbar flex shrink-0 items-center gap-2 border-b px-3 py-2">
      <button type="button" class="image-tool-btn" :class="{ active: fit }" title="Fit" @click="fit = true">Fit</button>
      <button type="button" class="image-tool-btn" :class="{ active: !fit && zoom === 1 }" title="100%" @click="setZoom(1)">100%</button>
      <button type="button" class="image-tool-btn" title="Zoom out" @click="setZoom(zoom - 0.1)">
        <div class="i-mdi-minus" />
      </button>
      <button type="button" class="image-tool-btn" title="Zoom in" @click="setZoom(zoom + 0.1)">
        <div class="i-mdi-plus" />
      </button>
      <span class="image-document-meta">
        {{ formatBytes(document.size) }}
        <template v-if="width && height"> · {{ width }} × {{ height }}</template>
      </span>
    </div>
    <div
      class="image-document-canvas min-h-0 flex-1 overflow-auto p-4"
      :class="fit ? 'is-fit' : 'is-zoom'"
    >
      <div v-if="document.loading" class="text-sm text-slate-400">Loading...</div>
      <div v-else-if="document.error" class="text-sm text-red-400">{{ document.error }}</div>
      <img v-else :src="document.imageData" :alt="document.name" :style="imageStyle" @load="onImageLoad">
    </div>
  </div>
</template>

<style scoped>
.image-document {
  background: var(--app-surface);
}
.image-document-toolbar {
  color: var(--app-text-secondary);
}
.image-tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--app-border);
  border-radius: 4px;
  background: var(--app-surface-soft);
  color: inherit;
  font-size: var(--app-font-control);
}
.image-tool-btn:hover,
.image-tool-btn.active {
  border-color: var(--app-primary);
  color: var(--app-primary);
}
.image-document-meta {
  margin-left: auto;
  font-size: var(--app-font-meta);
  color: var(--app-text-muted);
}
.image-document-canvas {
  background: color-mix(in srgb, var(--app-surface-soft) 62%, transparent);
}
.image-document-canvas.is-fit {
  display: flex;
  align-items: center;
  justify-content: center;
}
.image-document-canvas.is-zoom {
  display: block;
}
</style>
