<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { ZPopover } from 'ztools-ui'

/**
 * OCR 可视化组件（识别页 / 截图识别页共用）。
 *
 * 给定 imageSrc + lines，渲染：
 *   - canvas 绘制原图作为可见底图（CSS 等比缩放）
 *   - 透明文字层：按坐标百分比定位，hover 弹出该行文字、点击复制
 *   - 结果列表：与图上文字双向高亮联动
 *   - 全屏预览（Teleport 到 body）：滚轮缩放（以鼠标为锚点）、拖动、按钮缩放/复位
 *
 * 组件只负责展示，不做复制动作：点击文字行时 emit('copy', text)，
 * 由父组件用各自的 useToast 提示。
 */

const props = withDefaults(
  defineProps<{
    /** 可被 <img>/<canvas> 加载的图片源（data URI / http(s) URL）。父组件负责归一化。 */
    imageSrc: string
    /** OCR 识别结果行（带坐标）。 */
    lines: OcrLine[]
    /** 是否识别中（true 时图上叠遮罩 + 文案）。 */
    loading?: boolean
    /** 无图片时的空态文案。 */
    emptyText?: string
  }>(),
  { loading: false, emptyText: '' }
)

const emit = defineEmits<{
  (e: 'copy', text: string): void
}>()

// ─── canvas 绘图 ─────────────────────────────────────────────────────
// canvas 内部分辨率 = 原图自然像素；CSS 控制等比缩放显示。
const canvasRef = ref<HTMLCanvasElement | null>(null)
const naturalWidth = ref(0)
const naturalHeight = ref(0)
const lastImg = ref<HTMLImageElement | null>(null)

// 把图片按自然像素尺寸绘制到 canvas；canvas 在 imageSrc 渲染后才挂载，故用 nextTick。
function loadAndDraw(dataUrl: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = async () => {
      naturalWidth.value = img.naturalWidth
      naturalHeight.value = img.naturalHeight
      lastImg.value = img
      await nextTick()
      drawToCanvas(img)
      resolve()
    }
    img.onerror = () => resolve()
    img.src = dataUrl
  })
}

function drawToCanvas(img: HTMLImageElement) {
  const canvas = canvasRef.value
  if (!canvas || !img) return
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
}

// 容器尺寸变化或窗口缩放后，canvas 的 CSS 显示尺寸跟着变，
// 此时文字层（按百分比定位）天然对齐，无需重绘 canvas 内容。
watch([canvasRef, naturalWidth, naturalHeight], () => {
  if (lastImg.value) drawToCanvas(lastImg.value)
})

// 图源变化：重新加载并绘制
watch(
  () => props.imageSrc,
  (src) => {
    if (src) loadAndDraw(src)
    else {
      naturalWidth.value = 0
      naturalHeight.value = 0
      lastImg.value = null
    }
  },
  { immediate: true }
)

// ─── 文字层（百分比定位）+ 结果列表双向高亮 ──────────────────────────
const hasResult = computed(() => props.lines.length > 0)

function pct(value: number, total: number): number {
  if (!total) return 0
  return (value / total) * 100
}

interface OverlayLine {
  text: string
  rate: number
  left: number
  top: number
  width: number
  height: number
}

const overlays = computed<OverlayLine[]>(() =>
  props.lines.map((l) => ({
    text: l.text,
    rate: l.rate,
    left: pct(l.left, naturalWidth.value),
    top: pct(l.top, naturalHeight.value),
    width: pct(l.right - l.left, naturalWidth.value),
    height: pct(l.bottom - l.top, naturalHeight.value)
  }))
)

// 列表↔图片高亮联动：鼠标在某一侧 hover 时另一侧同步高亮
const hoveredIndex = ref<number | null>(null)

function copyText(text: string) {
  emit('copy', text)
}

// ─── 全屏预览（支持滚轮缩放 + 拖动） ─────────────────────────────────
// 用一个固定定位的遮罩层铺满视口，内部重新按原图自然像素绘制 canvas，
// 文字层按百分比定位天然对齐。ESC / 点击遮罩空白处退出。
//
// 缩放与拖动通过 CSS transform 实现（translate + scale），不重绘 canvas。
const fullscreen = ref(false)
const fullscreenCanvas = ref<HTMLCanvasElement | null>(null)
// canvas 实际显示尺寸（fit 后的 px，transform 的基准）
const fsBaseW = ref(0)
const fsBaseH = ref(0)
const fsScale = ref(1)
const fsOffset = ref({ x: 0, y: 0 })

// 拖动状态
const dragging = ref(false)
let pointerActive = false
let dragStart = { x: 0, y: 0 }
let dragOriginOffset = { x: 0, y: 0 }

const fsTransform = computed(
  () =>
    `translate(calc(-50% + ${fsOffset.value.x}px), calc(-50% + ${fsOffset.value.y}px)) scale(${fsScale.value})`
)

// 计算 fit（contain）后的 canvas 显示尺寸，作为缩放基准
function computeBaseSize() {
  const img = lastImg.value
  if (!img) return
  const maxW = window.innerWidth - 96
  const maxH = window.innerHeight - 96
  const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1)
  fsBaseW.value = Math.max(1, Math.round(img.naturalWidth * ratio))
  fsBaseH.value = Math.max(1, Math.round(img.naturalHeight * ratio))
}

function drawFullscreen() {
  if (!lastImg.value || !fullscreenCanvas.value) return
  const img = lastImg.value
  const canvas = fullscreenCanvas.value
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  computeBaseSize()
}

function resetFsView() {
  fsScale.value = 1
  fsOffset.value = { x: 0, y: 0 }
}

// 按钮缩放：以视口中心为锚点
function zoomBy(factor: number) {
  const next = Math.min(8, Math.max(1, fsScale.value * factor))
  const ratio = next / fsScale.value
  fsOffset.value = {
    x: fsOffset.value.x * ratio,
    y: fsOffset.value.y * ratio
  }
  fsScale.value = next
}

function openFullscreen() {
  if (!props.imageSrc) return
  resetFsView()
  fullscreen.value = true
  nextTick(drawFullscreen)
}

function closeFullscreen() {
  fullscreen.value = false
  dragging.value = false
}

// 滚轮缩放：以鼠标位置为锚点
function onFsWheel(e: WheelEvent) {
  e.preventDefault()
  const overlay = e.currentTarget as HTMLElement
  const rect = overlay.getBoundingClientRect()
  // 鼠标相对视口中心的坐标
  const mx = e.clientX - rect.left - rect.width / 2
  const my = e.clientY - rect.top - rect.height / 2

  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
  const next = Math.min(8, Math.max(1, fsScale.value * factor))
  const ratio = next / fsScale.value
  // 锚点保持：新偏移 = 鼠标点 - (鼠标点 - 旧偏移) * 缩放比
  fsOffset.value = {
    x: mx - (mx - fsOffset.value.x) * ratio,
    y: my - (my - fsOffset.value.y) * ratio
  }
  fsScale.value = next
}

// 拖动：仅在移动超过阈值后才真正进入拖拽，避免误吞文字点击复制
const DRAG_THRESHOLD = 4

function onFsPointerDown(e: PointerEvent) {
  // 仅主键（左键）开始拖拽
  if (e.button !== 0) return
  pointerActive = true
  dragStart = { x: e.clientX, y: e.clientY }
  dragOriginOffset = { ...fsOffset.value }
}

function onFsPointerMove(e: PointerEvent) {
  if (!pointerActive) return
  const dx = e.clientX - dragStart.x
  const dy = e.clientY - dragStart.y
  if (!dragging.value && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
  if (!dragging.value) {
    dragging.value = true
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  fsOffset.value = {
    x: dragOriginOffset.x + dx,
    y: dragOriginOffset.y + dy
  }
}

function onFsPointerUp(e: PointerEvent) {
  pointerActive = false
  if (dragging.value) {
    dragging.value = false
    ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
  }
}

function onFullscreenKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeFullscreen()
}

// 窗口尺寸变化：全屏态下重算基准尺寸并复位视图
function onFsResize() {
  if (!fullscreen.value) return
  computeBaseSize()
  resetFsView()
}

onMounted(() => {
  window.addEventListener('keydown', onFullscreenKeydown)
  window.addEventListener('resize', onFsResize)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onFullscreenKeydown)
  window.removeEventListener('resize', onFsResize)
})
</script>

<template>
  <div class="viewer">
    <div v-if="imageSrc" class="canvas-wrap">
      <!-- 用 canvas 绘制原图作为可见底图；CSS 等比缩放 -->
      <canvas ref="canvasRef" class="stage-canvas"></canvas>
      <!-- 全屏按钮 -->
      <button
        type="button"
        class="fs-btn"
        title="全屏预览"
        aria-label="全屏预览"
        @click="openFullscreen"
      >
        ⛶
      </button>
      <!-- 透明文字层：按百分比定位，鼠标可选中 -->
      <div v-if="hasResult" class="overlay">
        <ZPopover
          v-for="(o, i) in overlays"
          :key="i"
          trigger="hover"
          placement="top"
          :keep-alive-on-hover="true"
          :show-arrow="true"
          :class="{ active: hoveredIndex === i }"
          :style="{
            left: o.left + '%',
            top: o.top + '%',
            width: o.width + '%',
            height: o.height + '%'
          }"
          class="overlay-line"
        >
          <!-- 触发器：透明文字块（点击复制） -->
          <template #trigger>
            <div
              class="overlay-trigger"
              @mouseenter="hoveredIndex = i"
              @mouseleave="hoveredIndex = null"
              @click="copyText(o.text)"
            >
              <span class="overlay-text">{{ o.text }}</span>
            </div>
          </template>

          <!-- Popover 内容：预览该行识别文字 -->
          <div class="tooltip-content">
            {{ o.text }}
          </div>
        </ZPopover>
      </div>
      <!-- 识别中遮罩 -->
      <div v-if="loading" class="loading-overlay">识别中…</div>
    </div>
    <div v-else class="empty">
      <div class="empty-icon" :class="{ spin: loading }">{{ loading ? '🔍' : '🖼️' }}</div>
      <div class="empty-text">
        {{ loading ? '识别中…' : emptyText || '等待图片' }}
      </div>
    </div>

    <!-- 明细结果列表 -->
    <div v-if="hasResult" class="result">
      <div class="result-head">
        <span class="result-title">识别明细（{{ lines.length }} 行）</span>
        <span class="result-tip">图上文字可直接鼠标选中，或点击对应文字复制</span>
      </div>
      <div
        v-for="(line, i) in lines"
        :key="i"
        class="result-line"
        :class="{ active: hoveredIndex === i }"
        @mouseenter="hoveredIndex = i"
        @mouseleave="hoveredIndex = null"
        @click="copyText(line.text)"
      >
        <span class="result-rate">{{ (line.rate * 100).toFixed(0) }}%</span>
        <span class="result-text">{{ line.text }}</span>
      </div>
    </div>

    <!-- 全屏预览遮罩 -->
    <Teleport to="body">
      <div
        v-if="fullscreen"
        class="fs-overlay"
        @click.self="closeFullscreen"
        @wheel.prevent="onFsWheel"
      >
        <div
          class="fs-wrap"
          :class="{ 'is-dragging': dragging }"
          :style="{ width: fsBaseW + 'px', height: fsBaseH + 'px', transform: fsTransform }"
          @pointerdown="onFsPointerDown"
          @pointermove="onFsPointerMove"
          @pointerup="onFsPointerUp"
          @pointercancel="onFsPointerUp"
        >
          <canvas ref="fullscreenCanvas" class="fs-canvas"></canvas>
          <!-- 透明文字层：按百分比定位，复用 overlays -->
          <div v-if="hasResult" class="overlay">
            <ZPopover
              v-for="(o, i) in overlays"
              :key="i"
              trigger="hover"
              placement="top"
              :keep-alive-on-hover="true"
              :show-arrow="true"
              :class="{ active: hoveredIndex === i }"
              :style="{
                left: o.left + '%',
                top: o.top + '%',
                width: o.width + '%',
                height: o.height + '%'
              }"
              class="overlay-line"
            >
              <template #trigger>
                <div
                  class="overlay-trigger"
                  @mouseenter="hoveredIndex = i"
                  @mouseleave="hoveredIndex = null"
                  @click="copyText(o.text)"
                >
                  <span class="overlay-text">{{ o.text }}</span>
                </div>
              </template>
              <div class="tooltip-content">
                {{ o.text }}
              </div>
            </ZPopover>
          </div>
        </div>
        <button
          type="button"
          class="fs-close"
          title="退出全屏（Esc）"
          aria-label="退出全屏"
          @click="closeFullscreen"
        >
          ✕
        </button>
        <!-- 缩放指示 + 复位 -->
        <div class="fs-indicator">
          <button
            type="button"
            class="fs-zoom-btn"
            title="缩小"
            aria-label="缩小"
            :disabled="fsScale <= 1"
            @click.stop="zoomBy(1 / 1.2)"
          >
            −
          </button>
          <span class="fs-zoom-text">{{ Math.round(fsScale * 100) }}%</span>
          <button
            type="button"
            class="fs-zoom-btn"
            title="放大"
            aria-label="放大"
            @click.stop="zoomBy(1.2)"
          >
            +
          </button>
          <button
            type="button"
            class="fs-reset"
            title="复位（1:1）"
            @click.stop="resetFsView"
          >
            复位
          </button>
        </div>
        <!-- 操作提示 -->
        <div class="fs-hint">滚轮缩放 · 拖动移动 · Esc 退出</div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.viewer {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* canvas-wrap 是一个 inline-block，宽度由图片等比决定，
   内部 canvas/img/overlay 全部按其宽高百分比定位。
   align-self: center 既让画布在容器内水平居中，又阻止父级 flex column
   把它拉伸到全宽——否则 overlay（inset:0）会比实际显示的 canvas 宽，
   按百分比定位的文字层就会与底图错位。 */
.canvas-wrap {
  position: relative;
  display: inline-block;
  align-self: center;
  max-width: 100%;
  line-height: 0;
}

/* 全屏按钮：落在 canvas-wrap 右下角 */
.fs-btn {
  position: absolute;
  right: 6px;
  bottom: 6px;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 17px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s;
  z-index: 2;
}

.canvas-wrap:hover .fs-btn {
  opacity: 1;
}

.fs-btn:hover {
  background: rgba(0, 0, 0, 0.72);
}

.stage-canvas {
  display: block;
  max-width: 100%;
  max-height: 56vh;
  width: auto;
  height: auto;
  object-fit: contain;
  user-select: none;
  border-radius: 6px;
  /* canvas 内部分辨率 = 原图自然像素；这里用 CSS 等比缩放显示 */
}

/* ── 识别中遮罩 ── */
.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  font-size: 14px;
  border-radius: 6px;
  z-index: 3;
}

/* ── 透明文字覆盖层 ── */
.overlay {
  position: absolute;
  inset: 0;
  pointer-events: none; /* 默认整层不挡事件，逐块开启 */
}

/* .overlay-line 落在 ZPopover 的根元素上：按百分比绝对定位 */
.overlay-line {
  position: absolute;
  box-sizing: border-box;
  pointer-events: auto;
  border-radius: 2px;
  background: transparent;
  transition: background 0.12s, box-shadow 0.12s;
}

.overlay-line.active {
  background: rgba(25, 118, 210, 0.12);
  box-shadow: 0 0 0 1px rgba(25, 118, 210, 0.6) inset;
}

/* 触发器填满 popover 根元素，承载透明文字与点击复制 */
.overlay-trigger {
  width: 100%;
  height: 100%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.overlay-text {
  font-size: 0.9em;
  line-height: 1.1;
  color: transparent; /* 透明，不影响看到底图，但可被鼠标选中 */
  user-select: text;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
  padding: 0 1px;
}

/* ── Popover 内容：预览该行识别文字 ── */
.tooltip-content {
  font-size: 12px;
  line-height: 1.4;
  word-break: break-all;
}

/* ── 空态 ── */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 40px 0;
}

.empty-icon {
  font-size: 40px;
  opacity: 0.6;
}

.empty-icon.spin {
  animation: spin 1.2s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.empty-text {
  font-size: 13px;
  color: var(--text-secondary, #999);
}

/* ── 明细结果列表 ── */
.result {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-top: 1px solid var(--border-color, #e5e6eb);
  padding-top: 14px;
}

.result-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 4px;
}

.result-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary, #666);
}

.result-tip {
  font-size: 11px;
  color: var(--text-secondary, #999);
}

.result-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 14px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s;
}

.result-line:hover,
.result-line.active {
  background: var(--hover-bg, rgba(0, 0, 0, 0.05));
}

.result-rate {
  color: var(--text-secondary, #999);
  font-size: 12px;
  min-width: 34px;
  flex-shrink: 0;
}

.result-text {
  white-space: pre-wrap;
  word-break: break-all;
  user-select: text;
}
</style>

<!-- 全屏遮罩层样式（非 scoped：因为通过 Teleport 到 body，scoped 选择器会失效） -->
<style>
.fs-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
  cursor: zoom-out;
}

.fs-wrap {
  position: absolute;
  top: 50%;
  left: 50%;
  /* transform 由内联 style 注入（translate + scale） */
  transform-origin: center center;
  line-height: 0;
  cursor: grab;
  user-select: none;
  touch-action: none;
}

.fs-wrap.is-dragging {
  cursor: grabbing;
}

.fs-canvas {
  display: block;
  width: 100%;
  height: 100%;
  user-select: none;
  border-radius: 6px;
}

/* 复用文字层定位规则（teleport 后独立声明） */
.fs-wrap .overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.fs-wrap .overlay-line {
  position: absolute;
  box-sizing: border-box;
  pointer-events: auto;
  border-radius: 2px;
  background: transparent;
  transition: background 0.12s, box-shadow 0.12s;
}

.fs-wrap .overlay-line.active {
  background: rgba(25, 118, 210, 0.12);
  box-shadow: 0 0 0 1px rgba(25, 118, 210, 0.6) inset;
}

.fs-wrap .overlay-trigger {
  width: 100%;
  height: 100%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.fs-wrap .overlay-text {
  font-size: 0.9em;
  line-height: 1.1;
  color: transparent;
  user-select: text;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
  padding: 0 1px;
}

.fs-close {
  position: fixed;
  top: 20px;
  right: 24px;
  width: 38px;
  height: 38px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.fs-close:hover {
  background: rgba(255, 255, 255, 0.3);
}

/* 缩放指示器（右上） */
.fs-indicator {
  position: fixed;
  top: 20px;
  right: 72px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(6px);
}

.fs-zoom-btn {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.fs-zoom-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.3);
}

.fs-zoom-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.fs-zoom-text {
  min-width: 42px;
  text-align: center;
  color: #fff;
  font-size: 12px;
}

.fs-reset {
  border: none;
  border-radius: 14px;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s;
}

.fs-reset:hover {
  background: rgba(255, 255, 255, 0.3);
}

.fs-hint {
  position: fixed;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  pointer-events: none;
}
</style>
