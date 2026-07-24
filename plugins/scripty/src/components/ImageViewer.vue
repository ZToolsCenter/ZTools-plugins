<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 全屏图片预览：点击图片后浮于所有抽屉/弹窗之上，支持滚轮/按钮缩放与自由拖拽平移。
 * 通过 Teleport 挂到 body 并使用高于 ZDrawer(10000) 的 z-index，确保覆盖详情抽屉。
 * 缩放围绕光标位置进行（标准图片查看器体验），拖拽用 Pointer Events 以兼容鼠标与触屏。
 */
const props = defineProps<{
  src: string
  alt?: string
}>()
const emit = defineEmits<{ (event: 'close'): void }>()

/** 全屏覆盖层；其中心即图片静止位置，也是滚轮缩放的坐标原点参考。 */
const overlayRef = ref<HTMLDivElement | null>(null)
/** 当前缩放倍数；1 表示图片以 max-box 适配后的原始尺寸展示。 */
const scale = ref(1)
/** 相对居中静止位置的像素位移。 */
const translateX = ref(0)
const translateY = ref(0)
/** 主指针按下并在拖动图片时为真，用于切换光标样式。 */
const dragging = ref(false)

const MIN_SCALE = 0.2
const MAX_SCALE = 12
/** 单次缩放倍率（滚轮一格、按钮一次、键盘 +/- 一次）。 */
const ZOOM_STEP = 1.2

const imageStyle = computed(() => ({
  transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value})`
}))

const scaleLabel = computed(() => `${Math.round(scale.value * 100)}%`)

let pointerId: number | null = null
let startPointerX = 0
let startPointerY = 0
let startTranslateX = 0
let startTranslateY = 0

/** 把候选缩放值限制在支持区间内，避免归零或过度放大。 */
function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
}

/** 开始拖拽：记录起始指针与当前位移，pointermove 据此计算增量。 */
function onPointerDown(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  pointerId = event.pointerId
  startPointerX = event.clientX
  startPointerY = event.clientY
  startTranslateX = translateX.value
  startTranslateY = translateY.value
  dragging.value = true
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value || event.pointerId !== pointerId) return
  translateX.value = startTranslateX + (event.clientX - startPointerX)
  translateY.value = startTranslateY + (event.clientY - startPointerY)
}

function onPointerUp(event: PointerEvent) {
  if (event.pointerId !== pointerId) return
  dragging.value = false
  pointerId = null
}

/**
 * 滚轮缩放保持光标下方的点不动。默认中心 transform-origin 下，
 * `transform: translate(t) scale(s)` 将本地点 p 投影到 `中心 + t + s·p`；
 * 反解出缩放后仍锚定光标的位移即得下式。
 */
function onWheel(event: WheelEvent) {
  event.preventDefault()
  const overlay = overlayRef.value
  if (!overlay) return
  const rect = overlay.getBoundingClientRect()
  const cursorFromCenterX = event.clientX - (rect.left + rect.width / 2)
  const cursorFromCenterY = event.clientY - (rect.top + rect.height / 2)
  const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
  zoomToward(cursorFromCenterX, cursorFromCenterY, factor)
}

/**
 * 按指定倍率缩放，并保持 (anchorX, anchorY)（相对覆盖层中心）这点不动。
 * 按钮缩放传入 (0, 0) 即围绕图片中心；滚轮缩放传入光标坐标。
 */
function zoomToward(anchorX: number, anchorY: number, factor: number) {
  const newScale = clampScale(scale.value * factor)
  if (newScale === scale.value) return
  const ratio = newScale / scale.value
  translateX.value = anchorX * (1 - ratio) + ratio * translateX.value
  translateY.value = anchorY * (1 - ratio) + ratio * translateY.value
  scale.value = newScale
}

/** 重置为居中适配视图。 */
function resetView() {
  scale.value = 1
  translateX.value = 0
  translateY.value = 0
}

/** 围绕图片中心缩放一步，供工具栏按钮复用。 */
function zoomByStep(factor: number) {
  zoomToward(0, 0, factor)
}

/** 键盘等价：Esc 关闭、0 重置、+/- 缩放。 */
function onKeydown(event: KeyboardEvent) {
  switch (event.key) {
    case 'Escape':
      emit('close')
      break
    case '0':
      resetView()
      break
    case '+':
    case '=':
      zoomByStep(ZOOM_STEP)
      break
    case '-':
    case '_':
      zoomByStep(1 / ZOOM_STEP)
      break
    default:
      return
  }
  event.stopPropagation()
  event.preventDefault()
}

/** 点击空白背板关闭；点击图片或工具栏不关闭。 */
function onBackdropClick(event: MouseEvent) {
  if (event.target === overlayRef.value) emit('close')
}

onMounted(() => {
  // 捕获阶段监听，使 Esc 在此先行处理并阻止冒泡，避免详情抽屉的按键逻辑误关抽屉。
  document.addEventListener('keydown', onKeydown, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown, true)
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="overlayRef"
      class="image-viewer"
      role="dialog"
      aria-modal="true"
      :aria-label="props.alt ?? '图片预览'"
      @click="onBackdropClick"
      @wheel="onWheel"
    >
      <img
        :src="props.src"
        :alt="props.alt ?? '图片预览'"
        class="image-viewer__img"
        :class="{ 'image-viewer__img--grabbing': dragging }"
        draggable="false"
        :style="imageStyle"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @dblclick="resetView"
      />
      <div class="image-viewer__toolbar" @click.stop>
        <button class="image-viewer__btn" type="button" aria-label="缩小" title="缩小（− 或滚轮下）" @click="zoomByStep(1 / ZOOM_STEP)">−</button>
        <span class="image-viewer__scale">{{ scaleLabel }}</span>
        <button class="image-viewer__btn" type="button" aria-label="放大" title="放大（+ 或滚轮上）" @click="zoomByStep(ZOOM_STEP)">+</button>
        <button class="image-viewer__btn" type="button" aria-label="重置" title="重置（0 或双击）" @click="resetView">⟲</button>
        <button class="image-viewer__btn image-viewer__btn--close" type="button" aria-label="关闭" title="关闭（Esc）" @click="emit('close')">×</button>
      </div>
      <p class="image-viewer__hint">滚轮缩放 · 拖拽移动 · 双击重置 · Esc 关闭</p>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.image-viewer {
  position: fixed;
  inset: 0;
  z-index: 100000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.88);
  user-select: none;
}

.image-viewer__img {
  max-width: 92vw;
  max-height: 92vh;
  object-fit: contain;
  transform-origin: center center;
  will-change: transform;
  touch-action: none;
  cursor: grab;
}

.image-viewer__img--grabbing {
  cursor: grabbing;
}

.image-viewer__toolbar {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: 10px;
  background: rgba(32, 32, 32, 0.82);
  color: #fff;
  font-size: 13px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
}

.image-viewer__btn {
  display: grid;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 8px;
  place-items: center;
  background: transparent;
  color: #fff;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s ease;
}

.image-viewer__btn:hover {
  background: rgba(255, 255, 255, 0.18);
}

.image-viewer__btn--close {
  margin-left: 6px;
  font-size: 22px;
}

.image-viewer__scale {
  min-width: 46px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.image-viewer__hint {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  pointer-events: none;
}
</style>
