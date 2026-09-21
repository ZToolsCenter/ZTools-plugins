<template>
  <div class="right-panel-scroll">
    <div class="section-title">小尺寸预览</div>
    <div class="preview-panel">
      <div class="preview-bg-switcher" role="group" aria-label="预览背景">
        <button
          v-for="mode in backgroundOptions"
          :key="mode.value"
          type="button"
          class="preview-bg-btn"
          :class="{ active: backgroundMode === mode.value }"
          @click="$emit('set-background-mode', mode.value)"
        >{{ mode.label }}</button>
      </div>
      <div class="preview-grid">
        <div
          v-for="item in items"
          :key="item.size"
          class="preview-card"
        >
          <div
            class="preview-stage"
            :class="stageClass"
            :style="{ width: `${item.width}px`, height: `${item.height}px` }"
          >
            <img
              v-if="item.dataUrl"
              class="preview-image"
              :src="item.dataUrl"
              :width="item.width"
              :height="item.height"
              :alt="`${item.size}px 图标预览`"
            />
          </div>
          <div class="preview-size-label">{{ item.size }}px</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { PreviewBackgroundMode, PreviewItem } from '../../types'

type PreviewBackgroundOption = {
  value: PreviewBackgroundMode
  label: string
}

defineProps<{
  backgroundOptions: PreviewBackgroundOption[]
  backgroundMode: PreviewBackgroundMode
  items: PreviewItem[]
  stageClass: string
}>()

defineEmits<{
  (event: 'set-background-mode', mode: PreviewBackgroundMode): void
}>()
</script>

<style lang="scss" scoped>
.preview-panel {
  padding: 0 8px 12px;
}
.preview-bg-switcher {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  margin-bottom: 12px;
}
.preview-bg-btn {
  border: 1px solid var(--control-border);
  border-radius: 4px;
  padding: 5px 4px;
  background: var(--control-bg);
  color: var(--text-color);
  cursor: pointer;
  font-size: 12px;
  &.active {
    color: var(--primary-color);
    border-color: var(--primary-color);
    background: rgba(0, 128, 255, 0.08);
  }
}
.preview-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.preview-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 10px 6px;
  border: 1px solid rgba(128, 128, 128, 0.16);
  border-radius: 6px;
  background: color-mix(in srgb, var(--control-bg) 78%, transparent);
}
.preview-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
  box-shadow: 0 0 0 1px rgba(128, 128, 128, 0.24);
  image-rendering: auto;
  &.preview-bg-transparent {
    background-color: #fff;
    background-image:
      linear-gradient(45deg, rgba(0, 0, 0, 0.12) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.12) 75%, rgba(0, 0, 0, 0.12)),
      linear-gradient(45deg, rgba(0, 0, 0, 0.12) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.12) 75%, rgba(0, 0, 0, 0.12));
    background-position: 0 0, 4px 4px;
    background-size: 8px 8px;
  }
  &.preview-bg-light {
    background: #fff;
  }
  &.preview-bg-dark {
    background: #111827;
  }
}
.preview-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.preview-size-label,
.preview-hint {
  font-size: 11px;
  color: #777;
  line-height: 1.35;
}
.preview-hint {
  margin-top: 10px;
}
.right-panel-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  min-width: 300px;
  padding: 5px 10px 10px;
}
.section-title {
  font-weight: 700;
  font-size: 12px;
  padding: 6px 4px;
  color: #555;
}
</style>
