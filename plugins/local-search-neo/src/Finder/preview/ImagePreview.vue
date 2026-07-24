<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";

const props = defineProps<{
  source: string;
}>();

const emit = defineEmits<{
  "context-menu": [event: MouseEvent];
}>();

const imageSize = shallowRef<{ width: number; height: number } | null>(null);
const isSvg = computed(() => /\.svg(?:$|[?#])/i.test(props.source));
const imageSizeLabel = computed(() => {
  if (isSvg.value || !imageSize.value) return "";
  return `${imageSize.value.width} × ${imageSize.value.height}`;
});

watch(
  () => props.source,
  () => {
    imageSize.value = null;
  },
);

function updateImageSize(event: Event) {
  if (isSvg.value || !(event.target instanceof HTMLImageElement)) return;
  imageSize.value = {
    width: event.target.naturalWidth,
    height: event.target.naturalHeight,
  };
}
</script>

<template>
  <div class="image-preview" @contextmenu.prevent.stop="emit('context-menu', $event)">
    <header class="image-info-bar" :class="{ empty: !imageSizeLabel }">
      <span>{{ imageSizeLabel }}</span>
    </header>
    <div class="preview-media-shell">
      <img
        class="preview-image"
        :class="{ 'svg-image': isSvg }"
        :src="source"
        alt=""
        @load="updateImageSize"
      />
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
}

.image-info-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 0;
  height: 30px;
  padding: 0 12px;
  color: #c3c8cf;
  border-bottom: 1px solid #282a2d;
  font-size: 12px;
  font-family: Consolas, "Cascadia Mono", monospace;
}

.image-info-bar.empty {
  visibility: hidden;
}

.preview-media-shell {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  padding: 12px;
  overflow: hidden;
}

.preview-image {
  display: block;
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
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
}
</style>
