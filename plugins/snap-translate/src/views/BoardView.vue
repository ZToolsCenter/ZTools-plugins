<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import {
  applyMove,
  applyZoom,
  applyResize,
  exclusiveDragMode,
  pointInRects,
  DEFAULT_DOCK_H,
  COLLAPSED_DOCK_H,
  type DragMode,
  type Rect
} from '../pinGeometry'
import {
  coverChipStyle,
  coverFillFromSample,
  drawPinOverlay,
  sampleBorderColor,
  type PinOverlayLine
} from '../pinOverlay'
import { loadSavedFromLang, loadSavedTargetLang } from '../composables/useLang'
import { loadBoardSettings, type BoardSettings } from '../composables/useBoardSettings'

/**
 * 贴窗：全屏透明层固定不动；图+图外底栏是层内 DOM。
 * Win 透明窗 setBounds/setPosition 会把尺寸读肥，所以窗口创建后永不改 bounds。
 */

type Tool = 'pen' | 'highlight' | 'line' | 'arrow' | 'rect' | 'eraser' | 'move'
type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
interface BoardPayload {
  image: string
  isDark?: boolean
  logo?: string
  title?: string
  pin?: { x: number; y: number; width: number; height: number; dockH?: number }
  overlay?: { x: number; y: number; width: number; height: number }
}

interface BoardUpdate {
  type?: string
  message?: string
  working?: boolean
  lines?: { text: string }[]
  overlayLines?: PinOverlayLine[]
  overlay?: { x: number; y: number; width: number; height: number }
  pin?: { x: number; y: number; width: number; height: number }
}

const loaded = ref(false)
const imageSrc = ref('')
const phaseWorking = ref(false)
const statusText = ref('')
const tipText = ref('')
const lines = ref<{ text: string }[]>([])
const boardSettings = ref<BoardSettings>(loadBoardSettings())
const tool = ref<Tool>('move')
const color = ref('#ff3b30')
const WIDTHS = [2, 4, 8] as const
/** 默认选中一个粗细。 */
const lineWidth = ref<number>(WIDTHS[0])
const showDrawTools = ref(false)
/** 工具栏默认展开；点箭头收起成细条。 */
const dockExpanded = ref(true)
const dockH = computed(() =>
  dockExpanded.value ? DEFAULT_DOCK_H : COLLAPSED_DOCK_H
)

const imgRef = ref<HTMLImageElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const overlayRef = ref<HTMLCanvasElement | null>(null)
const overlayLines = ref<PinOverlayLine[]>([])
const naturalW = ref(0)
const naturalH = ref(0)

let drawing = false
let startX = 0
let startY = 0
let lastDrawX = 0
let lastDrawY = 0
let highlightPts: { x: number; y: number }[] = []
let snapshot: ImageData | null = null
let tipTimer: number | undefined

let dragMode: DragMode = 'none'
let resizeEdge: Edge = 'se'
let originScreenX = 0
let originScreenY = 0
let lastPointerScreenX = 0
let lastPointerScreenY = 0
let zoomFactorAcc = 1
let zoomRaf = 0
let pinOrigin: Rect = { x: 80, y: 80, width: 400, height: 280 + DEFAULT_DOCK_H }
let mouseOverPin = true
let overlayOriginRect = { x: 0, y: 0, width: 0, height: 0 }

const pin = ref<Rect>({ x: 80, y: 80, width: 400, height: 280 + DEFAULT_DOCK_H })
const pinStyle = computed(() => ({
  left: pin.value.x + 'px',
  top: pin.value.y + 'px',
  width: pin.value.width + 'px',
  height: pin.value.height + 'px'
}))

const canDraw = computed(() => tool.value !== 'move' && !phaseWorking.value)
const hasLines = computed(() => lines.value.length > 0)
/** 贴图上已盖住译文时，「翻译」切成「原文」，点一下还原。 */
const hasOverlay = computed(() => overlayLines.value.length > 0)
const boardButtons = computed(() => boardSettings.value.buttons)
const showMainSep = computed(() => {
  const left = boardButtons.value.ocr || boardButtons.value.translate || boardButtons.value.copy || boardButtons.value.save
  const right = boardButtons.value.doodle || boardButtons.value.settings || boardButtons.value.close
  return left && right
})

const coverChips = computed(() => {
  const w = naturalW.value
  const h = naturalH.value
  if (!w || !h || !overlayLines.value.length) return []
  const stageW = Math.max(1, pin.value.width)
  const stageH = Math.max(1, pin.value.height - dockH.value)
  return overlayLines.value.map((l) => ({
    lines: l.lines && l.lines.length ? l.lines : l.text ? [l.text] : [],
    style: coverChipStyle(l, w, h, stageW, stageH)
  }))
})

watch(dockH, (next, prev) => {
  // prev 收起时为 0，不能用 || 兜底，否则展开那次不恢复高度，越点越小
  const d = next - (prev ?? DEFAULT_DOCK_H)
  if (!d) return
  pin.value = { ...pin.value, height: Math.max(pin.value.height + d, next + 48) }
  reportPin()
})

function overlayWork(): { x: number; y: number; width: number; height: number } {
  const w =
    overlayOriginRect.width > 0 ? overlayOriginRect.width : window.innerWidth
  const h =
    overlayOriginRect.height > 0 ? overlayOriginRect.height : window.innerHeight
  // 允许中心越过当前屏，好触发搬层到第二屏
  const slack = 480
  return { x: -slack, y: -slack, width: w + slack * 2, height: h + slack * 2 }
}

function overlayOrigin(): { x: number; y: number } {
  return overlayOriginRect
}

function reportPin(): void {
  const o = overlayOrigin()
  try {
    window.ztools.sendToParent('snap-board', {
      action: 'pin-rect',
      x: pin.value.x + o.x,
      y: pin.value.y + o.y,
      width: pin.value.width,
      height: pin.value.height,
      dragging: dragMode !== 'none'
    })
  } catch (_) {
    /* ignore */
  }
}

function setIgnoreMouse(ignore: boolean): void {
  try {
    window.ztools.sendToParent('snap-board', { action: 'ignore-mouse', ignore })
  } catch (_) {
    /* ignore */
  }
}

function tip(msg: string): void {
  tipText.value = msg
  window.clearTimeout(tipTimer)
  tipTimer = window.setTimeout(() => (tipText.value = ''), 2000)
}

function load(data: BoardPayload): void {
  imageSrc.value = data.image
  lines.value = []
  overlayLines.value = []
  loaded.value = true
  document.documentElement.classList.toggle('dark', !!data.isDark)
  if (data.overlay) {
    overlayOriginRect = {
      x: data.overlay.x,
      y: data.overlay.y,
      width: data.overlay.width,
      height: data.overlay.height
    }
  }
  if (data.pin && data.pin.width > 0 && data.pin.height > 0) {
    pin.value = {
      x: data.pin.x,
      y: data.pin.y,
      width: data.pin.width,
      height: data.pin.height
    }
  }
  nextTick(() => {
    setupCanvas()
    reportPin()
  })
}

function onUpdate(raw: Record<string, unknown>): void {
  const u = raw as BoardUpdate
  if (u.working === true) phaseWorking.value = true
  if (u.working === false) phaseWorking.value = false
  if (u.message) statusText.value = u.message
  if (Array.isArray(u.lines)) lines.value = u.lines
  if (u.type === 'error') {
    phaseWorking.value = false
    statusText.value = ''
    tip(u.message || '出错了')
  }
  if (u.type === 'ocr' || u.type === 'translate' || u.type === 'ocr-translate' || u.type === 'pin-overlay') {
    phaseWorking.value = false
    statusText.value = ''
    if (u.message) tip(u.message)
  }
  if (u.type === 'pin-overlay' && Array.isArray(u.overlayLines)) {
    overlayLines.value = u.overlayLines as PinOverlayLine[]
    nextTick(() => {
      tintOverlayLines()
      paintTextOverlay()
    })
  }
  if (u.type === 'overlay' && u.overlay) {
    overlayOriginRect = {
      x: u.overlay.x,
      y: u.overlay.y,
      width: u.overlay.width,
      height: u.overlay.height
    }
    if (u.pin && u.pin.width > 0) {
      pin.value = { x: u.pin.x, y: u.pin.y, width: u.pin.width, height: u.pin.height }
      if (dragMode === 'move' || dragMode === 'resize') {
        pinOrigin = { ...pin.value }
        originScreenX = lastPointerScreenX
        originScreenY = lastPointerScreenY
      }
    }
  }
}

function setupCanvas(): void {
  const img = imgRef.value
  const canvas = canvasRef.value
  if (!img || !canvas) return
  const apply = () => {
    naturalW.value = img.naturalWidth
    naturalH.value = img.naturalHeight
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    sizeOverlayCanvas()
    paintTextOverlay()
  }
  if (img.complete && img.naturalWidth) apply()
  else img.onload = apply
}

function sizeOverlayCanvas(): void {
  const c = overlayRef.value
  if (!c || !naturalW.value) return
  c.width = naturalW.value
  c.height = naturalH.value
}

function tintOverlayLines(): void {
  const img = imgRef.value
  const w = naturalW.value
  const h = naturalH.value
  if (!w || !h) return
  overlayLines.value = overlayLines.value.map((l) => {
    if (l.fill && l.color) return l
    const sampled = sampleBorderColor(img, l, w, h)
    const colors = coverFillFromSample(sampled.r, sampled.g, sampled.b)
    return { ...l, fill: colors.fill, color: colors.color }
  })
}

function paintTextOverlay(): void {
  const c = overlayRef.value
  if (!c) return
  if (c.width !== naturalW.value || c.height !== naturalH.value) sizeOverlayCanvas()
  const ctx = c.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, c.width, c.height)
  if (!overlayLines.value.length) return
  drawPinOverlay(ctx, overlayLines.value, imgRef.value)
}

function canvasPoint(e: PointerEvent): { x: number; y: number } {
  const canvas = canvasRef.value!
  const rect = canvas.getBoundingClientRect()
  return {
    x: ((e.clientX - rect.left) / rect.width) * canvas.width,
    y: ((e.clientY - rect.top) / rect.height) * canvas.height
  }
}

function applyStrokeStyle(ctx: CanvasRenderingContext2D): void {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (tool.value === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.globalAlpha = 1
    ctx.strokeStyle = '#000'
    ctx.lineWidth = lineWidth.value * 4
    return
  }
  if (tool.value === 'highlight') {
    ctx.globalCompositeOperation = 'multiply'
    ctx.globalAlpha = 0.28
    ctx.strokeStyle = color.value
    ctx.lineWidth = lineWidth.value * 7
    return
  }
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.strokeStyle = color.value
  ctx.fillStyle = color.value
  ctx.lineWidth = lineWidth.value
}

function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const head = Math.min(14 + lineWidth.value * 2.2, len * 0.4)
  const ux = dx / len
  const uy = dy / len
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2 - ux * head * 0.55, y2 - uy * head * 0.55)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - ux * head - uy * head * 0.45, y2 - uy * head + ux * head * 0.45)
  ctx.lineTo(x2 - ux * head + uy * head * 0.45, y2 - uy * head - ux * head * 0.45)
  ctx.closePath()
  ctx.fill()
}

function onDrawDown(e: PointerEvent): void {
  if (!canDraw.value) return
  e.stopPropagation()
  e.preventDefault()
  dragMode = 'none'
  const canvas = canvasRef.value
  if (!canvas) return
  canvas.setPointerCapture(e.pointerId)
  drawing = true
  const p = canvasPoint(e)
  startX = lastDrawX = p.x
  startY = lastDrawY = p.y
  highlightPts = tool.value === 'highlight' ? [{ x: p.x, y: p.y }] : []
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height)
  applyStrokeStyle(ctx)
}

function onDrawMove(e: PointerEvent): void {
  if (!drawing) return
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const p = canvasPoint(e)
  if (tool.value === 'highlight') {
    highlightPts.push(p)
    if (snapshot) ctx.putImageData(snapshot, 0, 0)
    applyStrokeStyle(ctx)
    ctx.beginPath()
    ctx.moveTo(highlightPts[0].x, highlightPts[0].y)
    for (let i = 1; i < highlightPts.length; i++) ctx.lineTo(highlightPts[i].x, highlightPts[i].y)
    ctx.stroke()
    return
  }
  if (tool.value === 'pen' || tool.value === 'eraser') {
    applyStrokeStyle(ctx)
    ctx.beginPath()
    ctx.moveTo(lastDrawX, lastDrawY)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    lastDrawX = p.x
    lastDrawY = p.y
    return
  }
  if (snapshot) ctx.putImageData(snapshot, 0, 0)
  applyStrokeStyle(ctx)
  if (tool.value === 'line') {
    ctx.beginPath()
    ctx.moveTo(startX, startY)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  } else if (tool.value === 'arrow') {
    drawArrow(ctx, startX, startY, p.x, p.y)
  } else if (tool.value === 'rect') {
    ctx.strokeRect(startX, startY, p.x - startX, p.y - startY)
  }
}

function onDrawUp(e: PointerEvent): void {
  if (!drawing) return
  drawing = false
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const p = canvasPoint(e)
  if (tool.value === 'line' || tool.value === 'rect' || tool.value === 'arrow') {
    if (snapshot) ctx.putImageData(snapshot, 0, 0)
    applyStrokeStyle(ctx)
    if (tool.value === 'line') {
      ctx.beginPath()
      ctx.moveTo(startX, startY)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
    } else if (tool.value === 'arrow') {
      drawArrow(ctx, startX, startY, p.x, p.y)
    } else {
      ctx.strokeRect(startX, startY, p.x - startX, p.y - startY)
    }
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  snapshot = null
  highlightPts = []
}

function clearMarks(): void {
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
}

function compositeImage(): string {
  if (!imageSrc.value || !naturalW.value) return imageSrc.value
  const c = document.createElement('canvas')
  c.width = naturalW.value
  c.height = naturalH.value
  const ctx = c.getContext('2d')
  if (!ctx || !imgRef.value) return imageSrc.value
  ctx.drawImage(imgRef.value, 0, 0)
  if (overlayRef.value) ctx.drawImage(overlayRef.value, 0, 0)
  if (canvasRef.value) ctx.drawImage(canvasRef.value, 0, 0)
  return c.toDataURL('image/png')
}

function onMoveDown(e: PointerEvent): void {
  const t = e.target as HTMLElement
  if (t.closest('.dock') || t.closest('.edge')) return
  if (canDraw.value) return
  dragMode = exclusiveDragMode(dragMode, 'move')
  originScreenX = e.screenX
  originScreenY = e.screenY
  pinOrigin = { ...pin.value }
  setIgnoreMouse(false)
  mouseOverPin = true
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  e.preventDefault()
}

function onEdgeDown(edge: Edge, e: PointerEvent): void {
  e.stopPropagation()
  e.preventDefault()
  if (canDraw.value) return
  dragMode = exclusiveDragMode(dragMode, 'resize')
  resizeEdge = edge
  originScreenX = e.screenX
  originScreenY = e.screenY
  pinOrigin = { ...pin.value }
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
}

function onPointerMove(e: PointerEvent): void {
  if (dragMode === 'none') return
  lastPointerScreenX = e.screenX
  lastPointerScreenY = e.screenY
  const dx = e.screenX - originScreenX
  const dy = e.screenY - originScreenY
  const work = overlayWork()
  if (dragMode === 'move') {
    pin.value = applyMove(pinOrigin, dx, dy, work)
    reportPin()
    return
  }
  if (dragMode === 'resize') {
    pin.value = applyResize(
      pinOrigin,
      { edge: resizeEdge, dx, dy },
      work,
      { dockH: dockH.value, aspect: pinOrigin.width / Math.max(pinOrigin.height - dockH.value, 1) }
    )
  }
}

function onPointerUp(): void {
  const wasDragging = dragMode === 'move' || dragMode === 'resize'
  dragMode = 'none'
  drawing = false
  if (wasDragging) reportPin()
}

function flushZoom(): void {
  zoomRaf = 0
  const factor = zoomFactorAcc
  zoomFactorAcc = 1
  if (!(factor > 0) || factor === 1) return
  pin.value = applyZoom(pin.value, factor, overlayWork(), {
    dockH: dockH.value,
    aspect: pin.value.width / Math.max(pin.value.height - dockH.value, 1)
  })
  reportPin()
}

function onWheel(e: WheelEvent): void {
  // 根据设置决定：普通滚轮直接缩放，或仅 Ctrl/Cmd + 滚轮缩放。
  // 拖动中绝不缩放：避免触控板惯性滚动误触发
  if (dragMode !== 'none') return
  if (boardSettings.value.wheelZoom === 'ctrl' && !e.ctrlKey && !e.metaKey) return
  e.preventDefault()
  const step = e.deltaY < 0 ? 1.06 : 1 / 1.06
  zoomFactorAcc *= step
  if (!zoomRaf) zoomRaf = window.requestAnimationFrame(flushZoom)
}

// ─── 动作 ─────────────────────────────────────────────
function langPayload(): { from: string; to: string } {
  return {
    from: loadSavedFromLang() || 'auto',
    to: loadSavedTargetLang() || 'auto'
  }
}

function send(action: string): void {
  phaseWorking.value = true
  statusText.value =
    action === 'ocr' ? '识别中…' : action === 'ocr-translate' ? '识别+翻译…' : '处理中…'
  try {
    window.ztools.sendToParent('snap-board', {
      action,
      image: imageSrc.value,
      composite: compositeImage(),
      imageWidth: naturalW.value,
      imageHeight: naturalH.value,
      ...langPayload()
    })
  } catch (_) {
    phaseWorking.value = false
    tip('无法联系主窗口')
  }
}

function sendTranslate(): void {
  if (hasOverlay.value) {
    clearOverlay()
    return
  }
  if (!hasLines.value) {
    send('ocr-translate')
    return
  }
  phaseWorking.value = true
  statusText.value = '翻译中…'
  try {
    window.ztools.sendToParent('snap-board', {
      action: 'translate',
      image: imageSrc.value,
      composite: compositeImage(),
      sourceLines: lines.value.map((l) => l.text),
      imageWidth: naturalW.value,
      imageHeight: naturalH.value,
      ...langPayload()
    })
  } catch (_) {
    phaseWorking.value = false
    tip('无法联系主窗口')
  }
}

/** 去掉译文覆盖，露出原图文字（不重新翻译）。 */
function clearOverlay(): void {
  overlayLines.value = []
  paintTextOverlay()
  tip('已恢复原文')
}

function copyImage(): void {
  const data = compositeImage() || imageSrc.value
  const closeAfter = boardSettings.value.copyAction === 'copy-close'
  try {
    if (typeof window.ztools?.copyImage === 'function') {
      window.ztools.copyImage(data)
      tip('已复制图片')
      if (closeAfter) closeWindow()
      return
    }
  } catch (_) {
    /* fallthrough */
  }
  try {
    window.ztools.sendToParent('snap-board', { action: 'copy-image', image: data, closeAfter })
    tip('已复制图片')
  } catch (_) {
    tip('复制失败')
  }
}

function saveImage(): void {
  try {
    window.ztools.sendToParent('snap-board', {
      action: 'save',
      image: compositeImage() || imageSrc.value,
      closeAfter: boardSettings.value.saveAction === 'save-close'
    })
  } catch (_) {
    tip('无法保存')
  }
}

function openSettings(): void {
  try {
    window.ztools.sendToParent('snap-board', { action: 'open-settings' })
  } catch (_) {
    tip('无法打开设置')
  }
}

function closeWindow(): void {
  try {
    window.ztools.sendToParent('snap-board', { action: 'close' })
  } catch (_) {
    /* ignore */
  }
  window.close()
}

function onDblClick(e: MouseEvent): void {
  if (boardSettings.value.closeGesture !== 'dblclick' && boardSettings.value.closeGesture !== 'both') return
  const t = e.target as HTMLElement
  if (t.closest('.dock') || t.closest('.edge')) return
  closeWindow()
}

function onContextMenu(e: MouseEvent): void {
  if (boardSettings.value.closeGesture !== 'rightclick' && boardSettings.value.closeGesture !== 'both') return
  const t = e.target as HTMLElement
  if (t.closest('.dock') || t.closest('.edge')) return
  e.preventDefault()
  closeWindow()
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeWindow()
  if ((e.key === 'c' || e.key === 'C') && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    copyImage()
  }
  if ((e.key === 's' || e.key === 'S') && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    saveImage()
  }
}

let hoverPoll = 0

function chromeRects(): Rect[] {
  const out: Rect[] = []
  document.querySelectorAll('.dock-main, .draw-panel, .collapse-btn.standalone').forEach((el) => {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) out.push({ x: r.x, y: r.y, width: r.width, height: r.height })
  })
  return out
}

function cursorOverPin(): boolean {
  try {
    if (typeof window.ztools.getCursorScreenPoint !== 'function') return true
    const pt = window.ztools.getCursorScreenPoint()
    const o = overlayOrigin()
    const p = pin.value
    const pinScreen = { x: p.x + o.x, y: p.y + o.y, width: p.width, height: p.height }
    const extra = chromeRects().map((r) => ({ ...r, x: r.x + o.x, y: r.y + o.y }))
    return pointInRects(pt.x, pt.y, [pinScreen, ...extra])
  } catch (_) {
    return true
  }
}

function onOverlayMove(e: MouseEvent): void {
  if (dragMode !== 'none') return
  const over = pointInRects(e.clientX, e.clientY, [pin.value, ...chromeRects()])
  if (over === mouseOverPin) return
  mouseOverPin = over
  setIgnoreMouse(!over)
}

onMounted(() => {
  window.__loadSnapBoard = load
  window.__boardUpdate = onUpdate
  window.addEventListener('keydown', onKey)
  // ignore-mouse + forward 只转发 mousemove，pointermove 到不了
  window.addEventListener('pointermove', onOverlayMove)
  window.addEventListener('mousemove', onOverlayMove)
  hoverPoll = window.setInterval(() => {
    if (dragMode !== 'none') return
    const over = cursorOverPin()
    if (over === mouseOverPin) return
    mouseOverPin = over
    setIgnoreMouse(!over)
  }, 80)
  document.documentElement.style.background = 'transparent'
  document.documentElement.style.height = '100%'
  document.documentElement.style.overflow = 'hidden'
  document.body.style.background = 'transparent'
  document.body.style.margin = '0'
  document.body.style.height = '100%'
  document.body.style.overflow = 'hidden'
  const appEl = document.getElementById('app')
  if (appEl) {
    appEl.style.height = '100%'
    appEl.style.overflow = 'hidden'
  }
  setIgnoreMouse(false)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('pointermove', onOverlayMove)
  window.removeEventListener('mousemove', onOverlayMove)
  window.clearTimeout(tipTimer)
  if (hoverPoll) window.clearInterval(hoverPoll)
  if (zoomRaf) window.cancelAnimationFrame(zoomRaf)
})
</script>

<template>
  <div class="overlay">
    <div
      v-if="loaded"
      class="stick"
      :class="{ drawing: canDraw }"
      :style="pinStyle"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @dblclick="onDblClick"
      @contextmenu.prevent="onContextMenu"
      @wheel="onWheel"
    >
      <div
        class="stage"
        :class="{ grab: !canDraw }"
        @pointerdown="onMoveDown"
      >
        <img ref="imgRef" :src="imageSrc" class="shot" alt="" draggable="false" />
        <div v-if="coverChips.length" class="text-covers">
          <div
            v-for="(chip, i) in coverChips"
            :key="i"
            class="cover-chip"
            :style="chip.style"
          >
            <span v-for="(row, ri) in chip.lines" :key="ri" class="cover-line">{{ row }}</span>
          </div>
        </div>
        <canvas ref="overlayRef" class="text-overlay" />
        <canvas
          ref="canvasRef"
          class="paint"
          :class="{ draw: canDraw }"
          @pointerdown="onDrawDown"
          @pointermove="onDrawMove"
          @pointerup="onDrawUp"
          @pointercancel="onDrawUp"
        />
        <div class="edge n" @pointerdown="onEdgeDown('n', $event)" />
        <div class="edge s" @pointerdown="onEdgeDown('s', $event)" />
        <div class="edge e" @pointerdown="onEdgeDown('e', $event)" />
        <div class="edge w" @pointerdown="onEdgeDown('w', $event)" />
        <div class="edge ne" @pointerdown="onEdgeDown('ne', $event)" />
        <div class="edge nw" @pointerdown="onEdgeDown('nw', $event)" />
        <div class="edge se" @pointerdown="onEdgeDown('se', $event)" />
        <div class="edge sw" @pointerdown="onEdgeDown('sw', $event)" />
        <Transition name="chip">
          <div v-if="phaseWorking || statusText || tipText" class="status-chip">
            {{ tipText || statusText }}
          </div>
        </Transition>
      </div>

      <div class="dock" :class="{ collapsed: !dockExpanded }" @pointerdown.stop>
        <template v-if="dockExpanded">
          <div v-if="showDrawTools" class="draw-panel" @pointerdown.stop>
            <div class="draw-row">
            <button class="icon-btn" :class="{ on: tool === 'move' }" title="拖动" @click="tool = 'move'">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13 6V3h-2v3H8l4 4 4-4zm-2 12v3h2v-3h3l-4-4-4 4zm8-5h3v-2h-3V8l-4 4 4 4zM6 11H3v2h3v3l4-4-4-4z"/></svg>
            </button>
            <button class="icon-btn" :class="{ on: tool === 'pen' }" title="画笔" @click="tool = 'pen'">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z"/></svg>
            </button>
            <button class="icon-btn" :class="{ on: tool === 'highlight' }" title="高亮" @click="tool = 'highlight'">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3.2 16.4 8.8 21l2.1-2.1-5.6-5.6zm14.3-12.2-2.1-2.1c-.8-.8-2-.8-2.8 0L6.4 8.3l7.7 7.7 6.2-6.2c.8-.8.8-2 0-2.8zM5.2 20.2H3v-2.2l.6-.6 2.2 2.2z"/></svg>
            </button>
            <button class="icon-btn" :class="{ on: tool === 'line' }" title="直线" @click="tool = 'line'">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4.5 20.5 19.5 3.5l1.4 1.4L5.9 21.9z"/></svg>
            </button>
            <button class="icon-btn" :class="{ on: tool === 'arrow' }" title="箭头" @click="tool = 'arrow'">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 13h11.17l-3.58 3.59L13 18l6-6-6-6-1.41 1.41L15.17 11H4z"/></svg>
            </button>
            <button class="icon-btn" :class="{ on: tool === 'rect' }" title="矩形" @click="tool = 'rect'">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 5v14h18V5zm16 12H5V7h14z"/></svg>
            </button>
            <button class="icon-btn" :class="{ on: tool === 'eraser' }" title="橡皮" @click="tool = 'eraser'">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.24 3.56 21 8.32 12.7 16.6 8 11.9zm-5.66 13.4L5 11.4 3.56 12.8a2 2 0 0 0 0 2.83L7.32 19.4H21v-2H10.58z"/></svg>
            </button>
            <span class="width-group" title="粗细">
              <button
                v-for="w in WIDTHS"
                :key="w"
                class="width-btn"
                :class="{ on: lineWidth === w }"
                @click="lineWidth = w"
              >
                <span class="width-dot" :style="{ width: w + 4 + 'px', height: w + 4 + 'px' }" />
              </button>
            </span>
            <input v-model="color" type="color" class="color" title="颜色" />
            <button class="icon-btn" title="清除" @click="clearMarks">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zm3-9h2v9H9zm4 0h2v9h-2zM15.5 4l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            </button>
            </div>
          </div>
          <div class="dock-main">
            <button v-if="boardButtons.ocr" class="btn" :disabled="phaseWorking" @click="send('ocr')">OCR</button>
            <button v-if="boardButtons.translate" class="btn primary" :disabled="phaseWorking" @click="sendTranslate">
              {{ hasOverlay ? '原文' : '翻译' }}
            </button>
            <button v-if="boardButtons.copy" class="btn" @click="copyImage">复制</button>
            <button v-if="boardButtons.save" class="btn" @click="saveImage">保存</button>
            <span v-if="showMainSep" class="dock-sep" />
            <button v-if="boardButtons.doodle" class="btn" :class="{ on: showDrawTools }" @click="showDrawTools = !showDrawTools" title="画笔 / 形状 / 橡皮">
              涂鸦
            </button>
            <button v-if="boardButtons.settings" class="btn ghost" title="OCR / 翻译设置" @click="openSettings">⚙</button>
            <button v-if="boardButtons.close" class="btn ghost" :title="boardSettings.closeGesture === 'rightclick' ? '右键图片也可关闭' : '双击图片也可关闭'" @click="closeWindow">关闭</button>
            <span class="dock-sep" />
            <button class="collapse-btn" :title="dockExpanded ? '收起工具栏' : '展开工具栏'" @click="dockExpanded = !dockExpanded">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  v-if="dockExpanded"
                  fill="currentColor"
                  d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z"
                />
                <path
                  v-else
                  fill="currentColor"
                  d="M12 16l6-6-1.41-1.41L12 13.17 7.41 8.59 6 10z"
                />
              </svg>
            </button>
          </div>
        </template>

        <button v-else class="collapse-btn standalone" :title="dockExpanded ? '收起工具栏' : '展开工具栏'" @click="dockExpanded = !dockExpanded">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 16l6-6-1.41-1.41L12 13.17 7.41 8.59 6 10z"
            />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: transparent;
  overflow: hidden;
}

.stick {
  position: absolute;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  /* 窄图时工具栏/涂鸦菜单可超出贴图框，必须完整展示 */
  overflow: visible;
  background: transparent;
  user-select: none;
  box-sizing: border-box;
}

.stage {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
  overflow: hidden;
  background: transparent;
  /* 贴图态：只框截图本身，不把下方菜单框进去 */
  border: 1px solid rgba(255, 255, 255, 0.22);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
  border-radius: 2px;
}
.stage:hover {
  border-color: rgba(255, 255, 255, 0.9);
}

.stage.grab {
  cursor: grab;
}
.stage.grab:active {
  cursor: grabbing;
}
.shot {
  width: 100%;
  height: 100%;
  object-fit: fill;
  display: block;
  pointer-events: none;
  border: none;
  outline: none;
}

.text-covers {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
}
.cover-chip {
  position: absolute;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  overflow: hidden;
  padding: 1px 3px;
  font-weight: 700;
  line-height: 1.1;
  white-space: nowrap;
  border-radius: 4px;
  box-shadow: inset 0 0 0 1px rgba(128, 128, 128, 0.45);
  background-clip: padding-box;
  -webkit-font-smoothing: antialiased;
}
.cover-line {
  display: block;
  line-height: 1.1;
  white-space: pre;
}
.text-overlay {
  opacity: 0;
}
.text-overlay,
.paint {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.paint.draw {
  pointer-events: auto;
  cursor: crosshair;
  touch-action: none;
}

.edge {
  position: absolute;
  z-index: 5;
  background: transparent;
}
.edge.n {
  top: 0;
  left: 8px;
  right: 8px;
  height: 6px;
  cursor: ns-resize;
}
.edge.s {
  bottom: 0;
  left: 8px;
  right: 8px;
  height: 6px;
  cursor: ns-resize;
}
.edge.e {
  right: 0;
  top: 8px;
  bottom: 8px;
  width: 6px;
  cursor: ew-resize;
}
.edge.w {
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 6px;
  cursor: ew-resize;
}
.edge.ne {
  top: 0;
  right: 0;
  width: 10px;
  height: 10px;
  cursor: nesw-resize;
}
.edge.nw {
  top: 0;
  left: 0;
  width: 10px;
  height: 10px;
  cursor: nwse-resize;
}
.edge.se {
  bottom: 0;
  right: 0;
  width: 10px;
  height: 10px;
  cursor: nwse-resize;
}
.edge.sw {
  bottom: 0;
  left: 0;
  width: 10px;
  height: 10px;
  cursor: nesw-resize;
}

.dock {
  flex: 0 0 auto;
  position: relative;
  height: 40px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 2px;
  background: transparent;
  box-sizing: border-box;
}
.dock.collapsed {
  height: 26px;
  min-height: 26px;
  padding: 0;
  background: transparent;
  justify-content: flex-start;
}
.dock.collapsed .collapse-btn.standalone {
  align-self: center;
  margin: 2px auto;
}

.collapse-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: rgba(28, 31, 36, 0.5);
  color: rgba(245, 245, 245, 0.85);
  cursor: pointer;
}
.collapse-btn:hover {
  background: rgba(28, 31, 36, 0.74);
  color: #fff;
}
.collapse-btn svg {
  width: 14px;
  height: 14px;
}
.collapse-btn.standalone {
  background: rgba(28, 31, 36, 0.5);
}

.dock-sep {
  width: 1px;
  height: 14px;
  background: rgba(128, 132, 140, 0.45);
  margin: 0 2px;
}

.draw-panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  display: flex;
  justify-content: center;
  width: max-content;
  max-width: calc(100vw - 12px);
  padding: 5px 8px;
  background: rgba(24, 27, 32, 0.94);
  border-radius: 10px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(8px);
  white-space: nowrap;
}

.draw-row {
  display: flex;
  flex-wrap: nowrap;
  gap: 2px;
  align-items: center;
}

.status-chip {
  position: absolute;
  left: 50%;
  bottom: 8px;
  transform: translateX(-50%);
  z-index: 6;
  max-width: 85%;
  padding: 3px 12px;
  border-radius: 999px;
  background: rgba(20, 22, 26, 0.78);
  color: #d6ecff;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.chip-enter-active,
.chip-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.chip-enter-from,
.chip-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-4px);
}

.dock-main {
  display: flex;
  flex-wrap: nowrap;
  gap: 3px;
  justify-content: center;
  align-items: center;
  padding: 2px 0;
  /* 贴图比工具栏窄时按内容宽展示，不裁切 */
  width: max-content;
}

.btn {
  border: none;
  background: rgba(20, 22, 26, 0.58);
  color: #f5f5f5;
  font-size: 11px;
  padding: 4px 7px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}
.btn:hover {
  background: rgba(30, 34, 40, 0.8);
}
.btn.primary {
  background: #409eff;
  color: #fff;
}
.btn.on {
  background: #409eff;
  color: #fff;
}
.btn.ghost {
  opacity: 0.9;
}
.btn.sm {
  padding: 3px 7px;
  font-size: 11px;
}
.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.icon-btn {
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #f0f0f0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.icon-btn svg {
  width: 16px;
  height: 16px;
  display: block;
}
.icon-btn:hover {
  background: rgba(255, 255, 255, 0.16);
}
.icon-btn.on {
  background: #409eff;
  color: #fff;
}

.width-group {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin: 0 2px;
}
.width-btn {
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.width-btn.on {
  background: rgba(255, 255, 255, 0.18);
}
.width-dot {
  display: block;
  border-radius: 50%;
  background: #f5f5f5;
}

.color {
  width: 22px;
  height: 22px;
  border: none;
  padding: 0;
  background: transparent;
  cursor: pointer;
}
</style>
