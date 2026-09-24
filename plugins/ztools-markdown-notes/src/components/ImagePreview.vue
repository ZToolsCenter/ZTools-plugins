<script setup lang="ts">
import { computed, ref } from 'vue'

defineProps<{
  src: string
  alt: string
}>()

const emit = defineEmits<{
  close: []
}>()

const fitWindow = ref(true)
const scale = ref(1)
const naturalWidth = ref(0)
const loadFailed = ref(false)
const stage = ref<HTMLElement | null>(null)
const isDragging = ref(false)
let dragStart = { x: 0, y: 0, left: 0, top: 0 }

const imageStyle = computed(() => fitWindow.value || naturalWidth.value === 0
  ? undefined
  : { width: `${naturalWidth.value * scale.value}px`, maxWidth: 'none', maxHeight: 'none' })

function showOriginalSize() {
  fitWindow.value = false
  scale.value = 1
}

function zoom(step: number) {
  fitWindow.value = false
  scale.value = Math.min(4, Math.max(0.25, Number((scale.value + step).toFixed(2))))
}

function handleLoad(event: Event) {
  naturalWidth.value = (event.target as HTMLImageElement).naturalWidth
  loadFailed.value = false
}

function handleWheel(event: WheelEvent) {
  zoom(event.deltaY < 0 ? 0.25 : -0.25)
}

function startDrag(event: PointerEvent) {
  if (fitWindow.value || event.button !== 0 || !stage.value) return
  isDragging.value = true
  dragStart = {
    x: event.clientX,
    y: event.clientY,
    left: stage.value.scrollLeft,
    top: stage.value.scrollTop,
  }
  stage.value.setPointerCapture(event.pointerId)
}

function moveDrag(event: PointerEvent) {
  if (!isDragging.value || !stage.value) return
  stage.value.scrollLeft = dragStart.left - (event.clientX - dragStart.x)
  stage.value.scrollTop = dragStart.top - (event.clientY - dragStart.y)
}

function stopDrag(event: PointerEvent) {
  if (!isDragging.value || !stage.value) return
  isDragging.value = false
  if (stage.value.hasPointerCapture(event.pointerId)) stage.value.releasePointerCapture(event.pointerId)
}
</script>

<template>
  <div class="image-preview-backdrop" @click.self="emit('close')">
    <section class="image-preview" role="dialog" aria-modal="true" aria-label="图片预览">
      <header class="image-preview-toolbar">
        <span :title="alt">{{ alt || '图片预览' }}</span>
        <div>
          <button type="button" @click="fitWindow = true">适应窗口</button>
          <button type="button" @click="showOriginalSize">原始大小</button>
          <button type="button" aria-label="缩小" title="缩小" @click="zoom(-0.25)">−</button>
          <span>{{ Math.round(scale * 100) }}%</span>
          <button type="button" aria-label="放大" title="放大" @click="zoom(0.25)">＋</button>
          <button type="button" aria-label="关闭图片预览" title="关闭 (Esc)" @click="emit('close')">×</button>
        </div>
      </header>
      <div
        ref="stage"
        class="image-preview-stage"
        :class="{ 'image-preview-stage--dragging': isDragging }"
        @pointerdown="startDrag"
        @pointermove="moveDrag"
        @pointerup="stopDrag"
        @pointercancel="stopDrag"
        @wheel.prevent="handleWheel"
      >
        <div class="image-preview-canvas">
          <p v-if="loadFailed" class="error-message">图片加载失败</p>
          <img
            v-else
            :src="src"
            :alt="alt"
            :class="{ 'image-preview-content--fit': fitWindow }"
            :style="imageStyle"
            :draggable="false"
            @load="handleLoad"
            @error="loadFailed = true"
          />
        </div>
      </div>
    </section>
  </div>
</template>
