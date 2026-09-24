<template>
  <div class="ruler-overlay" aria-hidden="true">
    <div class="ruler-corner"></div>
    <canvas
      class="ruler-h"
      ref="hCanvasRef"
      title="按下拖出水平参考线，右键打开参考线菜单"
      @mousedown="handleRulerMouseDown($event, 'horizontal')"
      @contextmenu.prevent="handleRulerContextMenu"
    ></canvas>
    <canvas
      class="ruler-v"
      ref="vCanvasRef"
      title="按下拖出垂直参考线，右键打开参考线菜单"
      @mousedown="handleRulerMouseDown($event, 'vertical')"
      @contextmenu.prevent="handleRulerContextMenu"
    ></canvas>
    <div
      v-if="horizontalHint.visible"
      class="ruler-coordinate-hint ruler-coordinate-hint-x"
      :style="{ left: `${horizontalHint.left}px`, top: `${horizontalHint.top}px` }"
    >
      {{ horizontalHint.label }}
    </div>
    <div
      v-if="verticalHint.visible"
      class="ruler-coordinate-hint ruler-coordinate-hint-y"
      :style="{ left: `${verticalHint.left}px`, top: `${verticalHint.top}px` }"
    >
      {{ verticalHint.label }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useZtoolsTheme } from 'ztools-ui'
import type { GuideOrientation } from '../documentGuides'

const props = defineProps<{
  scrollEl: HTMLElement | null
  wrapperEl: HTMLElement | null
  zoom: number
  coordinateHintActive: boolean
}>()

/** 标尺除展示刻度外还承载参考线拖拽：按下拖出参考线，右键唤出参考线菜单（由父组件渲染）。 */
const emit = defineEmits<{
  (event: 'guide-drag-start', payload: { orientation: GuideOrientation; position: number }): void
  (event: 'guide-drag-move', position: number): void
  (event: 'guide-drag-commit', payload: { orientation: GuideOrientation; position: number }): void
  (event: 'guide-drag-cancel'): void
  (event: 'guide-context-menu', payload: { x: number; y: number }): void
}>()

type CoordinateHintState = {
  visible: boolean
  left: number
  top: number
  label: string
}

const RULER_SIZE = 24
const TARGET_MAJOR_PX = 80
const HINT_GAP = 6
const HINT_HEIGHT = 24
const STEP_CANDIDATES = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]

const { isDark, primaryColor, customColor } = useZtoolsTheme()

function getCssVar(name: string, fallback: string, scopeEl?: Element | null) {
  if (typeof window === 'undefined') return fallback
  const candidates = [scopeEl, document.body, document.documentElement]
  for (const candidate of candidates) {
    if (!candidate) continue
    const value = getComputedStyle(candidate).getPropertyValue(name).trim()
    if (value) return value
  }
  return fallback
}

function getRulerColors() {
  const dark = isDark.value
  return {
    accent: getCssVar('--primary-color', '#0284c7', document.body),
    bg: getCssVar('--control-bg', dark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.035)', document.body),
    tick: getCssVar('--text-secondary', dark ? '#bfc0c3' : '#616161', document.body),
    label: getCssVar('--text-secondary', dark ? '#bfc0c3' : '#616161', document.body),
    border: getCssVar('--border-color', dark ? '#374151' : '#e5e7eb', document.body)
  }
}

const hCanvasRef = ref<HTMLCanvasElement | null>(null)
const vCanvasRef = ref<HTMLCanvasElement | null>(null)
const horizontalHint = ref<CoordinateHintState>(createCoordinateHintState())
const verticalHint = ref<CoordinateHintState>(createCoordinateHintState())

let lastClientX = -1
let lastClientY = -1
let cursorActive = false
let resizeObserver: ResizeObserver | null = null
let rafId: number | null = null
let attachedScrollEl: HTMLElement | null = null

// 创建坐标提示的初始结构，便于在多次重绘之间复用同一套状态字段。
function createCoordinateHintState(): CoordinateHintState {
  return {
    visible: false,
    left: 0,
    top: 0,
    label: ''
  }
}

// 将提示限制在标尺覆盖层内，避免靠边时直接溢出到外侧。
function clamp(value: number, min: number, max: number) {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

// 通过坐标文本长度估算提示宽度，避免为了定位再额外测量 DOM。
function estimateCoordinateHintWidth(label: string) {
  return Math.max(54, Math.round(label.length * 7.5 + 16))
}

function pickStep(zoom: number) {
  for (const c of STEP_CANDIDATES) {
    if (c * zoom >= TARGET_MAJOR_PX) return c
  }
  return STEP_CANDIDATES[STEP_CANDIDATES.length - 1]
}

function scheduleDraw() {
  if (rafId != null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    draw()
  })
}

function setupCanvas(canvas: HTMLCanvasElement, w: number, h: number) {
  const dpr = window.devicePixelRatio || 1
  const targetW = Math.max(1, Math.floor(w * dpr))
  const targetH = Math.max(1, Math.floor(h * dpr))
  if (canvas.width !== targetW) canvas.width = targetW
  if (canvas.height !== targetH) canvas.height = targetH
  canvas.style.width = w + 'px'
  canvas.style.height = h + 'px'
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  return ctx
}

// 在键盘释放、鼠标离开或尺寸不可用时同步隐藏顶部与左侧的坐标提示。
function hideCoordinateHints() {
  horizontalHint.value.visible = false
  verticalHint.value.visible = false
}

// 使用与标尺指针相同的换算结果更新 X/Y 提示，保证滚动和缩放后仍然贴合当前刻度。
function updateCoordinateHints(
  totalW: number,
  totalH: number,
  rulerW: number,
  rulerH: number,
  originHX: number,
  originVY: number,
  zoom: number,
  cursorX: number,
  cursorY: number
) {
  hideCoordinateHints()
  if (!props.coordinateHintActive) return
  if (cursorX === -1 || cursorY === -1) return

  const cursorScreenX = originHX + cursorX * zoom
  if (cursorScreenX >= 0 && cursorScreenX <= rulerW) {
    const label = `X: ${Math.round(cursorX)}`
    const width = estimateCoordinateHintWidth(label)
    horizontalHint.value.label = label
    horizontalHint.value.left = clamp(
      RULER_SIZE + cursorScreenX - width / 2,
      RULER_SIZE + 4,
      totalW - width - 4
    )
    horizontalHint.value.top = clamp(RULER_SIZE + HINT_GAP, RULER_SIZE + 4, totalH - HINT_HEIGHT - 4)
    horizontalHint.value.visible = true
  }

  const cursorScreenY = originVY + cursorY * zoom
  if (cursorScreenY >= 0 && cursorScreenY <= rulerH) {
    const label = `Y: ${Math.round(cursorY)}`
    const width = estimateCoordinateHintWidth(label)
    verticalHint.value.label = label
    verticalHint.value.left = clamp(RULER_SIZE + HINT_GAP, RULER_SIZE + 4, totalW - width - 4)
    verticalHint.value.top = clamp(
      RULER_SIZE + cursorScreenY - HINT_HEIGHT / 2,
      RULER_SIZE + 4,
      totalH - HINT_HEIGHT - 4
    )
    verticalHint.value.visible = true
  }
}

// 根据当前滚动、缩放与鼠标位置重绘标尺，并同步更新坐标提示。
function draw() {
  const scroll = props.scrollEl
  const wrapper = props.wrapperEl
  const hCanvas = hCanvasRef.value
  const vCanvas = vCanvasRef.value
  if (!scroll || !wrapper || !hCanvas || !vCanvas) {
    hideCoordinateHints()
    return
  }

  const scrollRect = scroll.getBoundingClientRect()
  const wrapperRect = wrapper.getBoundingClientRect()

  const totalW = scrollRect.width
  const totalH = scrollRect.height
  const rulerW = totalW - RULER_SIZE
  const rulerH = totalH - RULER_SIZE
  if (rulerW <= 0 || rulerH <= 0) {
    hideCoordinateHints()
    return
  }

  // canvas-px 0 in coords local to each ruler canvas (which itself starts at RULER_SIZE on its axis)
  const originHX = wrapperRect.left - scrollRect.left - RULER_SIZE
  const originVY = wrapperRect.top - scrollRect.top - RULER_SIZE

  const z = props.zoom > 0 ? props.zoom : 1
  const step = pickStep(z)
  const minorStep = Math.max(1, step / 5)

  // Cursor canvas-px coords (re-derived each draw so scroll/zoom keep it in sync)
  let cursorX = -1
  let cursorY = -1
  if (cursorActive) {
    cursorX = (lastClientX - wrapperRect.left) / z
    cursorY = (lastClientY - wrapperRect.top) / z
  }

  const ctxH = setupCanvas(hCanvas, rulerW, RULER_SIZE)
  drawHRuler(ctxH, rulerW, originHX, z, step, minorStep, cursorX)

  const ctxV = setupCanvas(vCanvas, RULER_SIZE, rulerH)
  drawVRuler(ctxV, rulerH, originVY, z, step, minorStep, cursorY)

  updateCoordinateHints(totalW, totalH, rulerW, rulerH, originHX, originVY, z, cursorX, cursorY)
}

function drawHRuler(
  ctx: CanvasRenderingContext2D,
  width: number,
  origin: number,
  zoom: number,
  step: number,
  minorStep: number,
  cursorCanvasX: number
) {
  const colors = getRulerColors()
  ctx.fillStyle = colors.bg
  ctx.fillRect(0, 0, width, RULER_SIZE)

  ctx.strokeStyle = colors.tick
  ctx.lineWidth = 1
  ctx.beginPath()

  const startCanvas = Math.floor(-origin / zoom / minorStep) * minorStep
  const endCanvas = Math.ceil((width - origin) / zoom / minorStep) * minorStep

  for (let cx = startCanvas; cx <= endCanvas; cx += minorStep) {
    const sx = origin + cx * zoom
    if (sx < -1 || sx > width + 1) continue
    const isMajor = Math.abs(cx % step) < 0.0001 || Math.abs((cx % step) - step) < 0.0001
    const tickLen = isMajor ? 10 : 4
    const x = Math.round(sx) + 0.5
    ctx.moveTo(x, RULER_SIZE - tickLen)
    ctx.lineTo(x, RULER_SIZE)
  }
  ctx.stroke()

  // Major labels
  ctx.fillStyle = colors.label
  ctx.font = '10px ui-sans-serif, system-ui, -apple-system, sans-serif'
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  const firstMajor = Math.ceil(startCanvas / step) * step
  for (let cx = firstMajor; cx <= endCanvas; cx += step) {
    const sx = origin + cx * zoom
    if (sx < -30 || sx > width + 30) continue
    ctx.fillText(String(Math.round(cx)), Math.round(sx) + 2, 2)
  }

  // Bottom border
  ctx.strokeStyle = colors.border
  ctx.beginPath()
  ctx.moveTo(0, RULER_SIZE - 0.5)
  ctx.lineTo(width, RULER_SIZE - 0.5)
  ctx.stroke()

  // Indicator
  if (cursorCanvasX !== -1) {
    const sx = origin + cursorCanvasX * zoom
    if (sx >= 0 && sx <= width) {
      ctx.fillStyle = colors.accent
      ctx.fillRect(Math.round(sx), 0, 1, RULER_SIZE)
    }
  }
}

function drawVRuler(
  ctx: CanvasRenderingContext2D,
  height: number,
  origin: number,
  zoom: number,
  step: number,
  minorStep: number,
  cursorCanvasY: number
) {
  const colors = getRulerColors()
  ctx.fillStyle = colors.bg
  ctx.fillRect(0, 0, RULER_SIZE, height)

  ctx.strokeStyle = colors.tick
  ctx.lineWidth = 1
  ctx.beginPath()

  const startCanvas = Math.floor(-origin / zoom / minorStep) * minorStep
  const endCanvas = Math.ceil((height - origin) / zoom / minorStep) * minorStep

  for (let cy = startCanvas; cy <= endCanvas; cy += minorStep) {
    const sy = origin + cy * zoom
    if (sy < -1 || sy > height + 1) continue
    const isMajor = Math.abs(cy % step) < 0.0001 || Math.abs((cy % step) - step) < 0.0001
    const tickLen = isMajor ? 10 : 4
    const y = Math.round(sy) + 0.5
    ctx.moveTo(RULER_SIZE - tickLen, y)
    ctx.lineTo(RULER_SIZE, y)
  }
  ctx.stroke()

  // Major labels (rotated -90deg)
  ctx.fillStyle = colors.label
  ctx.font = '10px ui-sans-serif, system-ui, -apple-system, sans-serif'
  const firstMajor = Math.ceil(startCanvas / step) * step
  for (let cy = firstMajor; cy <= endCanvas; cy += step) {
    const sy = origin + cy * zoom
    if (sy < -30 || sy > height + 30) continue
    ctx.save()
    ctx.translate(2, Math.round(sy) + 2)
    ctx.rotate(-Math.PI / 2)
    ctx.textBaseline = 'top'
    ctx.textAlign = 'right'
    ctx.fillText(String(Math.round(cy)), 0, 0)
    ctx.restore()
  }

  // Right border
  ctx.strokeStyle = colors.border
  ctx.beginPath()
  ctx.moveTo(RULER_SIZE - 0.5, 0)
  ctx.lineTo(RULER_SIZE - 0.5, height)
  ctx.stroke()

  // Indicator
  if (cursorCanvasY !== -1) {
    const sy = origin + cursorCanvasY * zoom
    if (sy >= 0 && sy <= height) {
      ctx.fillStyle = colors.accent
      ctx.fillRect(0, Math.round(sy), RULER_SIZE, 1)
    }
  }
}

// 记录最近一次鼠标位置，让标尺指针和坐标提示都能按当前视口实时刷新。
function onMouseMove(e: MouseEvent) {
  lastClientX = e.clientX
  lastClientY = e.clientY
  cursorActive = true
  scheduleDraw()
}

// 鼠标离开画布滚动区后立即清空指针显示，避免坐标提示停留在旧位置。
function onMouseLeave() {
  cursorActive = false
  scheduleDraw()
}

// ── 参考线拖拽（从标尺拖出水平 / 垂直参考线）──
// 拖拽期间监听 window 事件（指针可能移出标尺），松手时判断落点：
// 仍在标尺条带上视为取消，其余位置由父组件夹取后落定为参考线。
let guideDragOrientation: GuideOrientation | null = null

/** 把指针客户区坐标换算为画布坐标系下的参考线位置（未夹取，由运行时统一夹取）。 */
function computeGuidePosition(orientation: GuideOrientation, clientX: number, clientY: number) {
  const wrapper = props.wrapperEl
  if (!wrapper) return 0
  const rect = wrapper.getBoundingClientRect()
  const z = props.zoom > 0 ? props.zoom : 1
  return orientation === 'horizontal' ? (clientY - rect.top) / z : (clientX - rect.left) / z
}

/** 判断松手位置是否落回标尺条带（水平参考线看顶部标尺、垂直参考线看左侧标尺）。 */
function isPointerOnRuler(orientation: GuideOrientation, clientX: number, clientY: number) {
  const scroll = props.scrollEl
  if (!scroll) return false
  const rect = scroll.getBoundingClientRect()
  return orientation === 'horizontal'
    ? clientY - rect.top <= RULER_SIZE
    : clientX - rect.left <= RULER_SIZE
}

function onGuideDragMove(event: MouseEvent) {
  if (!guideDragOrientation) return
  emit('guide-drag-move', computeGuidePosition(guideDragOrientation, event.clientX, event.clientY))
}

function onGuideDragUp(event: MouseEvent) {
  const orientation = guideDragOrientation
  detachGuideDragListeners()
  guideDragOrientation = null
  if (!orientation) return
  if (isPointerOnRuler(orientation, event.clientX, event.clientY)) {
    // 拖回标尺区域：未落定的新参考线直接取消
    emit('guide-drag-cancel')
    return
  }
  emit('guide-drag-commit', {
    orientation,
    position: computeGuidePosition(orientation, event.clientX, event.clientY)
  })
}

/** 挂载拖拽期间的全局监听（mousemove 跟随预览、mouseup 落定）。 */
function attachGuideDragListeners() {
  window.addEventListener('mousemove', onGuideDragMove)
  window.addEventListener('mouseup', onGuideDragUp)
}

/** 释放拖拽期间的全局监听，避免异常路径下残留监听器。 */
function detachGuideDragListeners() {
  window.removeEventListener('mousemove', onGuideDragMove)
  window.removeEventListener('mouseup', onGuideDragUp)
}

// 在标尺上按下左键开始拖出新参考线；拖拽预览与落定都由父组件（运行时）处理。
function handleRulerMouseDown(event: MouseEvent, orientation: GuideOrientation) {
  if (event.button !== 0 || !props.wrapperEl) return
  event.preventDefault()
  guideDragOrientation = orientation
  emit('guide-drag-start', { orientation, position: computeGuidePosition(orientation, event.clientX, event.clientY) })
  attachGuideDragListeners()
}

// 右键标尺唤出参考线菜单（显隐开关 / 清除全部），菜单渲染在父组件。
function handleRulerContextMenu(event: MouseEvent) {
  if (event.button !== 2 && event.type !== 'contextmenu') return
  emit('guide-context-menu', { x: event.clientX, y: event.clientY })
}

// 绑定当前滚动容器的事件与尺寸观察，保证标尺和坐标提示都能跟随滚动区变化刷新。
function attach() {
  detach()
  const scroll = props.scrollEl
  const wrapper = props.wrapperEl
  if (!scroll) return
  scroll.addEventListener('scroll', scheduleDraw, { passive: true })
  scroll.addEventListener('mousemove', onMouseMove)
  scroll.addEventListener('mouseleave', onMouseLeave)
  attachedScrollEl = scroll
  resizeObserver = new ResizeObserver(scheduleDraw)
  resizeObserver.observe(scroll)
  if (wrapper) resizeObserver.observe(wrapper)
  window.addEventListener('resize', scheduleDraw)
  scheduleDraw()
}

// 释放旧滚动容器上的监听与动画帧，避免组件重挂后继续操作失效节点。
function detach() {
  if (attachedScrollEl) {
    attachedScrollEl.removeEventListener('scroll', scheduleDraw)
    attachedScrollEl.removeEventListener('mousemove', onMouseMove)
    attachedScrollEl.removeEventListener('mouseleave', onMouseLeave)
    attachedScrollEl = null
  }
  detachGuideDragListeners()
  guideDragOrientation = null
  resizeObserver?.disconnect()
  resizeObserver = null
  window.removeEventListener('resize', scheduleDraw)
  if (rafId != null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  hideCoordinateHints()
}

watch(
  () => [props.scrollEl, props.wrapperEl] as const,
  async () => {
    await nextTick()
    attach()
  },
  { immediate: true, flush: 'post' }
)

watch(() => [props.zoom, props.coordinateHintActive, isDark.value, primaryColor.value, customColor.value], scheduleDraw)

onBeforeUnmount(detach)
</script>

<style scoped>
.ruler-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
}
.ruler-corner {
  position: absolute;
  top: 0;
  left: 0;
  width: 24px;
  height: 24px;
  background: var(--control-bg, rgba(0, 0, 0, 0.035));
  border-right: 1px solid var(--border-color, #e5e7eb);
  border-bottom: 1px solid var(--border-color, #e5e7eb);
  box-sizing: border-box;
}
.ruler-h {
  position: absolute;
  top: 0;
  left: 24px;
  right: 0;
  height: 24px;
  display: block;
  /* 标尺画布开启指针事件以承载参考线拖拽与右键菜单（容器仍保持 none）。 */
  pointer-events: auto;
  cursor: row-resize;
}
.ruler-v {
  position: absolute;
  top: 24px;
  left: 0;
  bottom: 0;
  width: 24px;
  display: block;
  pointer-events: auto;
  cursor: col-resize;
}
.ruler-coordinate-hint {
  position: absolute;
  height: 24px;
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--primary-color, #0284c7);
  background: var(--dialog-bg, rgba(255, 255, 255, 0.96));
  color: var(--text-color, #111827);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.12);
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.ruler-coordinate-hint-x {
  transform-origin: top center;
}
.ruler-coordinate-hint-y {
  transform-origin: center left;
}
</style>
