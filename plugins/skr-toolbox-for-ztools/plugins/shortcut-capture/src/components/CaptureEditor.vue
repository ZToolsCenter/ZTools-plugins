<template>
  <main class="editor-shell" @contextmenu.prevent>
    <section class="stage" :style="stageStyle">
      <canvas
        ref="canvasRef"
        class="capture-canvas"
        :style="canvasStyle"
        @mousedown="onPointerDown"
        @mousemove="onPointerMove"
        @mouseup="onPointerUp"
        @mouseleave="onPointerUp"
        @dblclick="onDoubleClick"
      />
      <input
        v-if="activeInput"
        ref="textInputRef"
        v-model="activeInput.value"
        class="annotation-input"
        :style="annotationInputStyle"
        :placeholder="activeInput.kind === 'serialLabel' ? '说明' : '文字'"
        @mousedown.stop
        @mousemove.stop
        @mouseup.stop
        @keydown.enter.prevent="commitActiveInput"
        @keydown.esc.prevent="cancelActiveInput"
        @blur="commitActiveInput"
      >
    </section>

    <footer class="editor-toolbar">
      <button
        v-for="tool in tools"
        :key="tool.id"
        class="icon-button"
        :class="{ active: currentTool === tool.id }"
        type="button"
        :aria-label="tool.title"
        :data-tooltip="tool.title"
        @click="selectTool(tool.id)"
      >
        <span v-if="tool.iconClass" class="sh-icon" :class="tool.iconClass" aria-hidden="true"></span>
        <template v-else>{{ tool.icon }}</template>
      </button>

      <span class="divider"></span>

      <label class="toolbar-control swatch" aria-label="颜色" data-tooltip="颜色">
        <input v-model="color" type="color">
      </label>
      <label class="toolbar-control size-control" :data-tooltip="sizeTooltip">
        <input v-model.number="activeSize" class="size-input" :min="activeSizeRange.min" :max="activeSizeRange.max" type="number" :aria-label="sizeLabel">
        <span>px</span>
      </label>

      <span class="divider"></span>

      <button class="icon-button" type="button" aria-label="撤销" data-tooltip="撤销" @click="undo">
        <span class="sh-icon sh-icon-undo" aria-hidden="true"></span>
      </button>
      <button class="icon-button" type="button" aria-label="保存" data-tooltip="保存" @click="saveImage">
        <span class="sh-icon sh-icon-save" aria-hidden="true"></span>
      </button>
      <button class="icon-button confirm" type="button" aria-label="复制并关闭" data-tooltip="复制并关闭" @click="copyAndClose">✓</button>
      <button class="icon-button" type="button" aria-label="关闭" data-tooltip="关闭" @click="closeWindow">×</button>
    </footer>

    <div v-if="toast" class="editor-toast">{{ toast }}</div>
  </main>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const canvasRef = ref(null)
const currentTool = ref('move')
const color = ref('#ff2d55')
const lineWidth = ref(3)
const fontSizePx = ref(14)
const toast = ref('')
const activeInput = ref(null)
const textInputRef = ref(null)
const canvasCursor = ref('crosshair')

const editorData = ref(null)
const image = new Image()
let ctx = null
let drawing = false
let start = null
let last = null
let serial = 1
let toastTimer = 0
let annotationId = 1
let draftAnnotation = null
let movingAnnotation = null
let movingStart = null
let movingOriginal = null
let movingSaved = false
let resizingAnnotation = null
let resizeHandle = null
let resizeStart = null
let resizeOriginal = null
let resizeSaved = false
let syncingControls = false
let annotations = []
const history = []
const selectedAnnotationId = ref('')
const hoveredAnnotationId = ref('')

const tools = [
  { id: 'move', iconClass: 'sh-icon-move', title: '移动窗口' },
  { id: 'rect', iconClass: 'sh-icon-rect', title: '矩形' },
  { id: 'circle', iconClass: 'sh-icon-circle', title: '圆形' },
  { id: 'arrow', iconClass: 'sh-icon-arrow', title: '箭头' },
  { id: 'line', iconClass: 'sh-icon-line', title: '直线' },
  { id: 'brush', iconClass: 'sh-icon-brush', title: '画笔' },
  { id: 'mosaic', iconClass: 'sh-icon-mosaic', title: '马赛克' },
  { id: 'text', iconClass: 'sh-icon-text', title: '文字标注' },
  { id: 'serial', iconClass: 'sh-icon-serial', title: '序号标注' }
]

const textSizeTools = new Set(['text', 'serial'])

function selectedAnnotation() {
  return annotations.find((item) => item.id === selectedAnnotationId.value) || null
}

function hoveredAnnotation() {
  return annotations.find((item) => item.id === hoveredAnnotationId.value) || null
}

const selectedUsesFontSize = computed(() => {
  const selected = selectedAnnotation()
  return selected ? ['text', 'serial'].includes(selected.type) : textSizeTools.has(currentTool.value)
})

const activeSizeRange = computed(() => {
  if (selectedUsesFontSize.value) return { min: 8, max: 72 }
  return { min: 1, max: 24 }
})

const sizeLabel = computed(() => (selectedUsesFontSize.value ? '字号' : '线宽'))
const sizeTooltip = computed(() => `${sizeLabel.value} ${activeSize.value}px`)

const activeSize = computed({
  get() {
    return selectedUsesFontSize.value ? fontSizePx.value : lineWidth.value
  },
  set(value) {
    const range = activeSizeRange.value
    const numeric = Number(value)
    const normalized = Number.isFinite(numeric) ? Math.round(numeric) : range.min
    const next = Math.min(range.max, Math.max(range.min, normalized))
    if (selectedUsesFontSize.value) {
      fontSizePx.value = next
    } else {
      lineWidth.value = next
    }
  }
})

const displayWidth = computed(() => {
  const data = editorData.value
  if (!data) return 0
  return Math.max(1, Math.round(data.cssWidth * data.viewScale))
})

const displayHeight = computed(() => {
  const data = editorData.value
  if (!data) return 0
  return Math.max(1, Math.round(data.cssHeight * data.viewScale))
})

const canvasStyle = computed(() => ({
  width: `${displayWidth.value}px`,
  height: `${displayHeight.value}px`,
  cursor: currentTool.value === 'move' ? 'move' : canvasCursor.value,
  WebkitAppRegion: currentTool.value === 'move' ? 'drag' : 'no-drag'
}))

const stageStyle = computed(() => ({
  width: `${displayWidth.value}px`,
  height: `${displayHeight.value}px`,
  WebkitAppRegion: currentTool.value === 'move' ? 'drag' : 'no-drag'
}))

const annotationInputStyle = computed(() => {
  const input = activeInput.value
  if (!input) return {}
  return {
    left: `${input.displayX}px`,
    top: `${input.displayY}px`,
    minWidth: input.kind === 'serialLabel' ? '84px' : '120px',
    fontSize: `${input.displayFontSize}px`,
    color: input.color,
    background: 'rgba(255, 255, 255, 0.92)'
  }
})

function showToast(message) {
  toast.value = message
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toast.value = ''
  }, 1500)
}

function queryKey() {
  const hash = window.location.hash || ''
  const index = hash.indexOf('?')
  if (index === -1) return ''
  return new URLSearchParams(hash.slice(index + 1)).get('key') || ''
}

function readEditorData() {
  const key = queryKey()
  if (!key) throw new Error('缺少截图数据')
  const storageKey = `${window.shortcutCapture.editorKeyPrefix}${key}`
  const data = window.ztools?.dbStorage?.getItem(storageKey)
  window.ztools?.dbStorage?.removeItem?.(storageKey)
  if (!data || !data.dataUrl) throw new Error('截图数据已失效')
  return data
}

function cloneAnnotations(value = annotations) {
  return JSON.parse(JSON.stringify(value))
}

function pushHistory() {
  history.push({
    annotations: cloneAnnotations(),
    serial
  })
  if (history.length > 40) history.shift()
}

function undo() {
  const snapshot = history.pop()
  if (!snapshot) return
  annotations = cloneAnnotations(snapshot.annotations)
  serial = snapshot.serial
  selectedAnnotationId.value = ''
  hoveredAnnotationId.value = ''
  activeInput.value = null
  renderAll()
}

function renderBase() {
  const canvas = canvasRef.value
  if (!canvas || !ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
}

function renderAll(extra = null, includeUi = true) {
  if (!ctx) return
  renderBase()
  annotations.forEach((annotation) => drawAnnotation(annotation))
  if (extra) drawAnnotation(extra)
  if (includeUi) {
    drawHover()
    drawSelection()
  }
}

function getPoint(event) {
  const canvas = canvasRef.value
  const rect = canvas.getBoundingClientRect()
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height)
  }
}

function toDisplayPoint(point) {
  const canvas = canvasRef.value
  return {
    x: point.x * (displayWidth.value / canvas.width),
    y: point.y * (displayHeight.value / canvas.height)
  }
}

function displaySizeToCanvas(size) {
  const canvas = canvasRef.value
  if (!canvas || !displayWidth.value) return size
  return size * (canvas.width / displayWidth.value)
}

function applyCanvasStyle(style) {
  ctx.lineWidth = style.lineWidth || lineWidth.value
  ctx.strokeStyle = style.color || color.value
  ctx.fillStyle = style.color || color.value
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.font = `${style.fontSize || fontSize()}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
}

function applyStyle() {
  applyCanvasStyle({
    color: color.value,
    lineWidth: lineWidth.value,
    fontSize: fontSize()
  })
}

function fontSize() {
  return displaySizeToCanvas(fontSizePx.value)
}

function selectTool(tool) {
  commitActiveInput()
  currentTool.value = tool
  selectedAnnotationId.value = ''
  hoveredAnnotationId.value = ''
  canvasCursor.value = 'crosshair'
  renderAll()
}

function normalizeBox(from, to) {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y)
  }
}

function drawRect(from, to) {
  ctx.strokeRect(from.x, from.y, to.x - from.x, to.y - from.y)
}

function drawCircle(from, to) {
  const rx = Math.abs(to.x - from.x) / 2
  const ry = Math.abs(to.y - from.y) / 2
  const cx = (from.x + to.x) / 2
  const cy = (from.y + to.y) / 2
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  ctx.stroke()
}

function drawLine(from, to) {
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x, to.y)
  ctx.stroke()
}

function drawArrow(from, to, width = lineWidth.value) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  if (distance < 1) return
  const headLength = Math.min(distance * 0.36, Math.max(24, width * 10))
  const halfHead = Math.max(9, headLength * 0.46)
  const neckLength = headLength * 0.62
  const halfShaft = Math.max(width * 1.15, halfHead * 0.34)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const px = -sin
  const py = cos
  const headBase = {
    x: to.x - headLength * cos,
    y: to.y - headLength * sin
  }
  const neckCenter = {
    x: to.x - neckLength * cos,
    y: to.y - neckLength * sin
  }
  const neckLeft = {
    x: neckCenter.x + halfShaft * px,
    y: neckCenter.y + halfShaft * py
  }
  const neckRight = {
    x: neckCenter.x - halfShaft * px,
    y: neckCenter.y - halfShaft * py
  }
  const headLeft = {
    x: headBase.x + halfHead * px,
    y: headBase.y + halfHead * py
  }
  const headRight = {
    x: headBase.x - halfHead * px,
    y: headBase.y - halfHead * py
  }
  ctx.save()
  ctx.fillStyle = ctx.strokeStyle
  ctx.beginPath()
  ctx.moveTo(to.x, to.y)
  ctx.lineTo(headLeft.x, headLeft.y)
  ctx.lineTo(neckLeft.x, neckLeft.y)
  ctx.lineTo(from.x, from.y)
  ctx.lineTo(neckRight.x, neckRight.y)
  ctx.lineTo(headRight.x, headRight.y)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function drawBrush(annotation) {
  if (annotation.points.length < 2) return
  applyCanvasStyle(annotation)
  ctx.beginPath()
  ctx.moveTo(annotation.points[0].x, annotation.points[0].y)
  annotation.points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y))
  ctx.stroke()
}

function clampBox(box) {
  const canvas = canvasRef.value
  const x = Math.max(0, Math.floor(box.x))
  const y = Math.max(0, Math.floor(box.y))
  const right = Math.min(canvas.width, Math.ceil(box.x + box.width))
  const bottom = Math.min(canvas.height, Math.ceil(box.y + box.height))
  const width = right - x
  const height = bottom - y
  if (width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

function drawMosaicPreview(annotation) {
  const box = normalizeBox(annotation.from, annotation.to)
  ctx.save()
  ctx.setLineDash([6, 4])
  ctx.lineWidth = Math.max(1, annotation.lineWidth)
  ctx.strokeStyle = annotation.color
  ctx.fillStyle = 'rgba(26, 115, 232, 0.08)'
  ctx.fillRect(box.x, box.y, box.width, box.height)
  ctx.strokeRect(box.x, box.y, box.width, box.height)
  ctx.restore()
}

function drawMosaic(annotation) {
  if (annotation.draft) {
    drawMosaicPreview(annotation)
    return
  }
  const box = clampBox(normalizeBox(annotation.from, annotation.to))
  if (!box) return
  const blockSize = Math.max(6, (annotation.lineWidth || 1) * 5)
  const source = ctx.getImageData(box.x, box.y, box.width, box.height)
  for (let y = 0; y < box.height; y += blockSize) {
    for (let x = 0; x < box.width; x += blockSize) {
      const width = Math.min(blockSize, box.width - x)
      const height = Math.min(blockSize, box.height - y)
      let r = 0
      let g = 0
      let b = 0
      let count = 0
      for (let py = 0; py < height; py += 1) {
        for (let px = 0; px < width; px += 1) {
          const index = ((y + py) * box.width + x + px) * 4
          r += source.data[index]
          g += source.data[index + 1]
          b += source.data[index + 2]
          count += 1
        }
      }
      ctx.fillStyle = `rgb(${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)})`
      ctx.fillRect(box.x + x, box.y + y, width, height)
    }
  }
}

function drawTextAnnotation(annotation) {
  if (!annotation.text) return
  applyCanvasStyle(annotation)
  ctx.fillStyle = annotation.color
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(annotation.text, annotation.point.x, annotation.point.y)
}

function drawSerialAnnotation(annotation) {
  applyCanvasStyle(annotation)
  ctx.fillStyle = annotation.color
  ctx.beginPath()
  ctx.arc(annotation.point.x, annotation.point.y, annotation.radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 ${annotation.fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
  ctx.fillText(String(annotation.number), annotation.point.x, annotation.point.y + 1)
  if (annotation.text) {
    ctx.fillStyle = annotation.color
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.font = `${annotation.fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
    ctx.fillText(annotation.text, annotation.point.x + annotation.radius + 8, annotation.point.y + annotation.radius / 2)
  }
}

function drawAnnotation(annotation) {
  applyCanvasStyle(annotation)
  if (annotation.type === 'rect') drawRect(annotation.from, annotation.to)
  if (annotation.type === 'circle') drawCircle(annotation.from, annotation.to)
  if (annotation.type === 'line') drawLine(annotation.from, annotation.to)
  if (annotation.type === 'arrow') drawArrow(annotation.from, annotation.to, annotation.lineWidth)
  if (annotation.type === 'brush') drawBrush(annotation)
  if (annotation.type === 'mosaic') drawMosaic(annotation)
  if (annotation.type === 'text') drawTextAnnotation(annotation)
  if (annotation.type === 'serial') drawSerialAnnotation(annotation)
}

function boundsForAnnotation(annotation) {
  if (['rect', 'circle', 'line', 'arrow'].includes(annotation.type)) return normalizeBox(annotation.from, annotation.to)
  if (annotation.type === 'brush') {
    const xs = annotation.points.map((point) => point.x)
    const ys = annotation.points.map((point) => point.y)
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys)
    }
  }
  if (annotation.type === 'mosaic' && annotation.from && annotation.to) return normalizeBox(annotation.from, annotation.to)
  if (annotation.type === 'mosaic' && annotation.blocks) {
    const xs = annotation.blocks.flatMap((block) => [block.x, block.x + block.size])
    const ys = annotation.blocks.flatMap((block) => [block.y, block.y + block.size])
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys)
    }
  }
  if (annotation.type === 'text') {
    ctx.save()
    ctx.font = `${annotation.fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
    const width = Math.max(1, ctx.measureText(annotation.text || '').width)
    ctx.restore()
    return { x: annotation.point.x, y: annotation.point.y - annotation.fontSize, width, height: annotation.fontSize * 1.25 }
  }
  if (annotation.type === 'serial') {
    const labelWidth = annotation.text ? measureText(annotation.text, annotation.fontSize) : 0
    return {
      x: annotation.point.x - annotation.radius,
      y: annotation.point.y - annotation.radius,
      width: annotation.radius * 2 + (annotation.text ? 8 + labelWidth : 0),
      height: annotation.radius * 2
    }
  }
  return { x: 0, y: 0, width: 0, height: 0 }
}

function measureText(text, size) {
  ctx.save()
  ctx.font = `${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
  const width = ctx.measureText(text || '').width
  ctx.restore()
  return width
}

function drawSelection() {
  const annotation = selectedAnnotation()
  if (!annotation || !ctx) return
  const box = boundsForAnnotation(annotation)
  ctx.save()
  ctx.shadowColor = 'rgba(26, 115, 232, 0.32)'
  ctx.shadowBlur = 12
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
  ctx.fillStyle = 'rgba(26, 115, 232, 0.08)'
  ctx.fillRect(box.x - 5, box.y - 5, box.width + 10, box.height + 10)
  ctx.shadowBlur = 0
  ctx.setLineDash([6, 4])
  ctx.lineWidth = 1.5
  ctx.strokeStyle = 'rgba(26, 115, 232, 0.9)'
  ctx.strokeRect(box.x - 4, box.y - 4, box.width + 8, box.height + 8)
  ctx.setLineDash([])
  getResizeHandles(annotation).forEach((handle) => {
    const radius = 6
    ctx.fillStyle = 'rgba(255, 255, 255, 0.96)'
    ctx.strokeStyle = 'rgba(26, 115, 232, 0.95)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(handle.x, handle.y, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  })
  ctx.restore()
}

function drawHover() {
  const annotation = hoveredAnnotation()
  if (!annotation || !ctx || annotation.id === selectedAnnotationId.value) return
  const box = boundsForAnnotation(annotation)
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.28)'
  ctx.shadowBlur = 12
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 3
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)'
  ctx.fillRect(box.x - 5, box.y - 5, box.width + 10, box.height + 10)
  ctx.shadowBlur = 0
  ctx.setLineDash([4, 4])
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(26, 115, 232, 0.72)'
  ctx.strokeRect(box.x - 4, box.y - 4, box.width + 8, box.height + 8)
  ctx.restore()
}

function distanceToSegment(point, from, to) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (dx === 0 && dy === 0) return Math.hypot(point.x - from.x, point.y - from.y)
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy))
}

function pointInBox(point, box, padding = 0) {
  return point.x >= box.x - padding && point.x <= box.x + box.width + padding && point.y >= box.y - padding && point.y <= box.y + box.height + padding
}

function getResizeHandles(annotation) {
  if (!annotation) return []
  if (annotation.type === 'line' || annotation.type === 'arrow') {
    return [
      { name: 'from', x: annotation.from.x, y: annotation.from.y, cursor: 'move' },
      { name: 'to', x: annotation.to.x, y: annotation.to.y, cursor: 'move' }
    ]
  }
  const box = boundsForAnnotation(annotation)
  return [
    { name: 'nw', x: box.x, y: box.y, cursor: 'nwse-resize' },
    { name: 'ne', x: box.x + box.width, y: box.y, cursor: 'nesw-resize' },
    { name: 'se', x: box.x + box.width, y: box.y + box.height, cursor: 'nwse-resize' },
    { name: 'sw', x: box.x, y: box.y + box.height, cursor: 'nesw-resize' }
  ]
}

function hitResizeHandle(point) {
  const annotation = selectedAnnotation()
  if (!annotation) return null
  return getResizeHandles(annotation).find((handle) => (
    Math.hypot(point.x - handle.x, point.y - handle.y) <= 11
  )) || null
}

function hitRectStroke(annotation, point, padding) {
  const box = normalizeBox(annotation.from, annotation.to)
  if (!pointInBox(point, box, padding)) return false
  const edges = [
    [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y }],
    [{ x: box.x + box.width, y: box.y }, { x: box.x + box.width, y: box.y + box.height }],
    [{ x: box.x + box.width, y: box.y + box.height }, { x: box.x, y: box.y + box.height }],
    [{ x: box.x, y: box.y + box.height }, { x: box.x, y: box.y }]
  ]
  return edges.some(([from, to]) => distanceToSegment(point, from, to) <= padding)
}

function hitEllipseStroke(annotation, point, padding) {
  const box = normalizeBox(annotation.from, annotation.to)
  const rx = box.width / 2
  const ry = box.height / 2
  if (rx <= 0 || ry <= 0) return false
  const cx = box.x + rx
  const cy = box.y + ry
  const normalized = ((point.x - cx) ** 2) / (rx ** 2) + ((point.y - cy) ** 2) / (ry ** 2)
  const tolerance = padding / Math.max(1, Math.min(rx, ry))
  return Math.abs(Math.sqrt(normalized) - 1) <= tolerance
}

function hitAnnotation(annotation, point) {
  const padding = Math.max(6, annotation.lineWidth || 1)
  if (annotation.type === 'rect') return hitRectStroke(annotation, point, padding)
  if (annotation.type === 'circle') return hitEllipseStroke(annotation, point, padding)
  if (annotation.type === 'line' || annotation.type === 'arrow') return distanceToSegment(point, annotation.from, annotation.to) <= padding
  if (annotation.type === 'brush') {
    return annotation.points.some((current, index) => index > 0 && distanceToSegment(point, annotation.points[index - 1], current) <= padding)
  }
  if (annotation.type === 'mosaic' && annotation.from && annotation.to) return pointInBox(point, normalizeBox(annotation.from, annotation.to), padding)
  if (annotation.type === 'mosaic' && annotation.blocks) return annotation.blocks.some((block) => pointInBox(point, { x: block.x, y: block.y, width: block.size, height: block.size }, 2))
  if (annotation.type === 'text') return pointInBox(point, boundsForAnnotation(annotation), 4)
  if (annotation.type === 'serial') return pointInBox(point, boundsForAnnotation(annotation), 4)
  return false
}

function hitTest(point) {
  for (let i = annotations.length - 1; i >= 0; i -= 1) {
    if (hitAnnotation(annotations[i], point)) return annotations[i]
  }
  return null
}

function updateHoverCursor(point) {
  if (currentTool.value === 'move' || drawing || movingAnnotation || resizingAnnotation) return
  const handle = hitResizeHandle(point)
  if (handle) {
    canvasCursor.value = handle.cursor
    return
  }
  const hit = hitTest(point)
  const nextHoverId = hit?.id || ''
  canvasCursor.value = hit ? 'move' : 'crosshair'
  if (hoveredAnnotationId.value !== nextHoverId) {
    hoveredAnnotationId.value = nextHoverId
    renderAll()
  }
}

function resetCanvasCursor() {
  canvasCursor.value = 'crosshair'
  if (hoveredAnnotationId.value) {
    hoveredAnnotationId.value = ''
    renderAll()
  }
}

function moveAnnotation(annotation, dx, dy) {
  if (annotation.from) {
    annotation.from.x += dx
    annotation.from.y += dy
  }
  if (annotation.to) {
    annotation.to.x += dx
    annotation.to.y += dy
  }
  if (annotation.point) {
    annotation.point.x += dx
    annotation.point.y += dy
  }
  if (annotation.points) {
    annotation.points.forEach((point) => {
      point.x += dx
      point.y += dy
    })
  }
  if (annotation.blocks) {
    annotation.blocks.forEach((block) => {
      block.x += dx
      block.y += dy
    })
  }
}

function restoreMovingAnnotation(point) {
  const index = annotations.findIndex((item) => item.id === movingAnnotation.id)
  if (index === -1) return
  annotations[index] = cloneAnnotations([movingOriginal])[0]
  movingAnnotation = annotations[index]
  moveAnnotation(movingAnnotation, point.x - movingStart.x, point.y - movingStart.y)
}

function beginResizeAnnotation(annotation, handle, point) {
  canvasCursor.value = handle.cursor
  hoveredAnnotationId.value = ''
  selectedAnnotationId.value = annotation.id
  syncControlsFromAnnotation(annotation)
  resizingAnnotation = annotation
  resizeHandle = handle
  resizeStart = point
  resizeOriginal = cloneAnnotations([annotation])[0]
  resizeSaved = false
  renderAll()
}

function resizeBoxFromHandle(originalBox, handle, point) {
  let left = originalBox.x
  let top = originalBox.y
  let right = originalBox.x + originalBox.width
  let bottom = originalBox.y + originalBox.height
  if (handle.name.includes('w')) left = point.x
  if (handle.name.includes('e')) right = point.x
  if (handle.name.includes('n')) top = point.y
  if (handle.name.includes('s')) bottom = point.y
  if (Math.abs(right - left) < 4) right = left + (right >= left ? 4 : -4)
  if (Math.abs(bottom - top) < 4) bottom = top + (bottom >= top ? 4 : -4)
  return {
    x: Math.min(left, right),
    y: Math.min(top, bottom),
    width: Math.abs(right - left),
    height: Math.abs(bottom - top)
  }
}

function scalePointFromBox(point, fromBox, toBox) {
  const sx = fromBox.width ? (point.x - fromBox.x) / fromBox.width : 0
  const sy = fromBox.height ? (point.y - fromBox.y) / fromBox.height : 0
  return {
    x: toBox.x + sx * toBox.width,
    y: toBox.y + sy * toBox.height
  }
}

function scaleAnnotation(annotation, original, targetBox) {
  const originalBox = boundsForAnnotation(original)
  if (annotation.from && annotation.to) {
    annotation.from = scalePointFromBox(original.from, originalBox, targetBox)
    annotation.to = scalePointFromBox(original.to, originalBox, targetBox)
  }
  if (annotation.points) {
    annotation.points = original.points.map((point) => scalePointFromBox(point, originalBox, targetBox))
  }
  if (annotation.blocks) {
    const scaleX = originalBox.width ? targetBox.width / originalBox.width : 1
    const scaleY = originalBox.height ? targetBox.height / originalBox.height : 1
    annotation.blocks = original.blocks.map((block) => {
      const topLeft = scalePointFromBox({ x: block.x, y: block.y }, originalBox, targetBox)
      return {
        ...block,
        x: topLeft.x,
        y: topLeft.y,
        size: Math.max(4, block.size * Math.max(scaleX, scaleY))
      }
    })
  }
  if (annotation.type === 'text') {
    const scale = Math.max(0.35, targetBox.height / Math.max(1, originalBox.height))
    annotation.point = {
      x: targetBox.x,
      y: targetBox.y + original.fontSize * scale
    }
    annotation.fontSize = Math.max(6, original.fontSize * scale)
    annotation.displayFontSize = Math.max(8, original.displayFontSize * scale)
  }
  if (annotation.type === 'serial') {
    const scale = Math.max(0.35, Math.min(targetBox.width / Math.max(1, originalBox.width), targetBox.height / Math.max(1, originalBox.height)))
    annotation.point = {
      x: targetBox.x + original.radius * scale,
      y: targetBox.y + original.radius * scale
    }
    annotation.radius = Math.max(6, original.radius * scale)
    annotation.fontSize = Math.max(6, original.fontSize * scale)
    annotation.displayFontSize = Math.max(8, original.displayFontSize * scale)
  }
}

function restoreResizingAnnotation(point) {
  const index = annotations.findIndex((item) => item.id === resizingAnnotation.id)
  if (index === -1) return
  annotations[index] = cloneAnnotations([resizeOriginal])[0]
  resizingAnnotation = annotations[index]
  if (resizeHandle.name === 'from' || resizeHandle.name === 'to') {
    resizingAnnotation[resizeHandle.name] = { ...point }
    return
  }
  const targetBox = resizeBoxFromHandle(boundsForAnnotation(resizeOriginal), resizeHandle, point)
  scaleAnnotation(resizingAnnotation, resizeOriginal, targetBox)
}

function syncControlsFromAnnotation(annotation) {
  syncingControls = true
  color.value = annotation.color || color.value
  if (['text', 'serial'].includes(annotation.type)) {
    fontSizePx.value = Math.round(annotation.displayFontSize || annotation.fontSize * (displayWidth.value / canvasRef.value.width))
  } else if (annotation.lineWidth) {
    lineWidth.value = annotation.lineWidth
  }
  nextTick(() => {
    syncingControls = false
  })
}

function updateSelectedStyle() {
  if (syncingControls) return
  const annotation = selectedAnnotation()
  if (!annotation) return
  if (annotation.type !== 'mosaic') annotation.color = color.value
  if (['text', 'serial'].includes(annotation.type)) {
    annotation.displayFontSize = fontSizePx.value
    annotation.fontSize = fontSize()
    if (annotation.type === 'serial') annotation.radius = displaySizeToCanvas(Math.max(10, fontSizePx.value))
  } else {
    annotation.lineWidth = lineWidth.value
  }
  renderAll()
}

function startTextInput(point) {
  const displayPoint = toDisplayPoint(point)
  const canvasFontSize = fontSize()
  const displayFontSize = fontSizePx.value
  activeInput.value = {
    kind: 'text',
    value: '',
    point,
    displayX: displayPoint.x,
    displayY: Math.max(0, displayPoint.y - displayFontSize),
    canvasFontSize,
    displayFontSize,
    color: color.value,
    editId: ''
  }
  nextTick(() => {
    textInputRef.value?.focus()
  })
}

function startEditInput(annotation) {
  const isSerial = annotation.type === 'serial'
  const point = isSerial
    ? { x: annotation.point.x + annotation.radius + 8, y: annotation.point.y + annotation.radius / 2 }
    : annotation.point
  const displayPoint = toDisplayPoint(point)
  activeInput.value = {
    kind: isSerial ? 'serialLabel' : 'text',
    value: annotation.text || '',
    point: annotation.point,
    displayX: displayPoint.x,
    displayY: Math.max(0, displayPoint.y - annotation.displayFontSize),
    canvasFontSize: annotation.fontSize,
    displayFontSize: annotation.displayFontSize,
    color: annotation.color,
    editId: annotation.id
  }
  nextTick(() => {
    textInputRef.value?.focus()
    textInputRef.value?.select()
  })
}

function createSerialAnnotation(point) {
  pushHistory()
  const number = serial++
  const displayRadius = Math.max(10, fontSizePx.value)
  const radius = displaySizeToCanvas(displayRadius)
  const annotation = {
    id: `a${annotationId++}`,
    type: 'serial',
    point: { ...point },
    number,
    text: '',
    color: color.value,
    fontSize: fontSize(),
    displayFontSize: fontSizePx.value,
    radius
  }
  annotations.push(annotation)
  renderAll()
  return annotation
}

function startSerialInput(point) {
  const annotation = createSerialAnnotation(point)
  const displayPoint = toDisplayPoint({
    x: point.x + annotation.radius + 8,
    y: point.y
  })
  const displayRadius = Math.max(10, fontSizePx.value)
  activeInput.value = {
    kind: 'serialLabel',
    value: '',
    point,
    radius: annotation.radius,
    displayX: displayPoint.x,
    displayY: displayPoint.y - displayRadius - 2,
    canvasFontSize: fontSize(),
    displayFontSize: fontSizePx.value,
    color: color.value,
    editId: annotation.id
  }
  nextTick(() => {
    textInputRef.value?.focus()
  })
}

function drawTextValue(input) {
  const value = input.value.trim()
  if (input.editId) {
    const annotation = annotations.find((item) => item.id === input.editId)
    if (!annotation) return
    annotation.text = value
    renderAll()
    return
  }
  if (!value) return
  pushHistory()
  const annotation = {
    id: `a${annotationId++}`,
    type: 'text',
    text: value,
    point: { ...input.point },
    color: input.color,
    fontSize: input.canvasFontSize,
    displayFontSize: input.displayFontSize
  }
  annotations.push(annotation)
  renderAll()
}

function commitActiveInput() {
  const input = activeInput.value
  if (!input) return
  activeInput.value = null
  if (input.kind === 'text') {
    drawTextValue(input)
  } else if (input.kind === 'serialLabel') {
    drawTextValue(input)
  }
}

function cancelActiveInput() {
  activeInput.value = null
  renderAll()
}

function deleteSelectedAnnotation() {
  const annotation = selectedAnnotation()
  if (!annotation) return
  pushHistory()
  annotations = annotations.filter((item) => item.id !== annotation.id)
  selectedAnnotationId.value = ''
  hoveredAnnotationId.value = ''
  movingAnnotation = null
  resizingAnnotation = null
  resetCanvasCursor()
  renderAll()
}

function previewShape(point) {
  draftAnnotation = {
    id: 'draft',
    type: currentTool.value,
    from: { ...start },
    to: { ...point },
    color: color.value,
    lineWidth: lineWidth.value,
    draft: true
  }
  renderAll(draftAnnotation)
}

function beginMoveAnnotation(annotation, point) {
  canvasCursor.value = 'move'
  hoveredAnnotationId.value = ''
  selectedAnnotationId.value = annotation.id
  syncControlsFromAnnotation(annotation)
  movingAnnotation = annotation
  movingOriginal = cloneAnnotations([annotation])[0]
  movingStart = point
  movingSaved = false
  renderAll()
}

function onPointerDown(event) {
  commitActiveInput()
  if (currentTool.value === 'move') {
    selectedAnnotationId.value = ''
    hoveredAnnotationId.value = ''
    canvasCursor.value = 'crosshair'
    renderAll()
    return
  }
  event.preventDefault()
  const point = getPoint(event)
  const handle = hitResizeHandle(point)
  if (handle) {
    beginResizeAnnotation(selectedAnnotation(), handle, point)
    return
  }
  const hit = hitTest(point)
  if (hit) {
    beginMoveAnnotation(hit, point)
    return
  }
  selectedAnnotationId.value = ''
  if (currentTool.value === 'text') {
    startTextInput(point)
    return
  }
  if (currentTool.value === 'serial') {
    startSerialInput(point)
    return
  }
  drawing = true
  start = point
  last = point
  if (currentTool.value === 'brush') {
    pushHistory()
    draftAnnotation = {
      id: `a${annotationId++}`,
      type: 'brush',
      points: [{ ...point }],
      color: color.value,
      lineWidth: lineWidth.value
    }
    annotations.push(draftAnnotation)
    renderAll()
  }
}

function onPointerMove(event) {
  const point = getPoint(event)
  if (resizingAnnotation) {
    canvasCursor.value = resizeHandle.cursor
    const distance = Math.hypot(point.x - resizeStart.x, point.y - resizeStart.y)
    if (distance > 2 && !resizeSaved) {
      pushHistory()
      resizeSaved = true
    }
    if (distance > 2) {
      restoreResizingAnnotation(point)
      renderAll()
    }
    return
  }
  if (movingAnnotation) {
    canvasCursor.value = 'move'
    const distance = Math.hypot(point.x - movingStart.x, point.y - movingStart.y)
    if (distance > 2 && !movingSaved) {
      pushHistory()
      movingSaved = true
    }
    if (distance > 2) {
      restoreMovingAnnotation(point)
      renderAll()
    }
    return
  }
  if (!drawing) {
    updateHoverCursor(point)
    return
  }
  if (currentTool.value === 'brush') {
    draftAnnotation.points.push({ ...point })
    last = point
    renderAll()
    return
  }
  previewShape(point)
}

function onPointerUp(event) {
  if (event.type === 'mouseleave' && !movingAnnotation && !resizingAnnotation && !drawing) {
    resetCanvasCursor()
    return
  }
  if (resizingAnnotation) {
    const point = getPoint(event)
    syncControlsFromAnnotation(resizingAnnotation)
    resizingAnnotation = null
    resizeHandle = null
    resizeStart = null
    resizeOriginal = null
    resizeSaved = false
    updateHoverCursor(point)
    renderAll()
    return
  }
  if (movingAnnotation) {
    const point = getPoint(event)
    movingAnnotation = null
    movingStart = null
    movingOriginal = null
    movingSaved = false
    updateHoverCursor(point)
    renderAll()
    return
  }
  if (!drawing) return
  const point = getPoint(event)
  if (['rect', 'circle', 'line', 'arrow', 'mosaic'].includes(currentTool.value)) {
    if (Math.hypot(point.x - start.x, point.y - start.y) > 2) {
      pushHistory()
      const annotation = {
        id: `a${annotationId++}`,
        type: currentTool.value,
        from: { ...start },
        to: { ...point },
        color: color.value,
        lineWidth: lineWidth.value
      }
      annotations.push(annotation)
    }
  }
  drawing = false
  start = null
  last = null
  draftAnnotation = null
  updateHoverCursor(point)
  renderAll()
}

function onDoubleClick(event) {
  if (currentTool.value === 'move' || activeInput.value) return
  event.preventDefault()
  const point = getPoint(event)
  const annotation = hitTest(point)
  if (!annotation || !['text', 'serial'].includes(annotation.type)) return
  selectedAnnotationId.value = annotation.id
  syncControlsFromAnnotation(annotation)
  pushHistory()
  startEditInput(annotation)
}

function onKeyDown(event) {
  if (activeInput.value) return
  const target = event.target
  const isEditable = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
  if (isEditable) return
  if (event.key !== 'Delete' && event.key !== 'Backspace') return
  if (!selectedAnnotation()) return
  event.preventDefault()
  deleteSelectedAnnotation()
}

function canvasToBase64() {
  commitActiveInput()
  renderAll(null, false)
  const dataUrl = canvasRef.value.toDataURL('image/png')
  renderAll()
  return dataUrl
}

async function copyAndClose() {
  try {
    window.shortcutCapture.copyImage(canvasToBase64())
    closeWindow()
  } catch (error) {
    showToast(error.message || String(error))
  }
}

function saveImage() {
  try {
    commitActiveInput()
    renderAll()
    const savePath = window.shortcutCapture.showSaveDialog(window.shortcutCapture.getDefaultSavePath())
    if (!savePath) return
    window.shortcutCapture.saveDataUrl(canvasToBase64(), savePath)
    window.shortcutCapture.shellShowItemInFolder(savePath)
  } catch (error) {
    showToast(error.message || String(error))
  }
}

function closeWindow() {
  window.shortcutCapture.closeWindow(true)
}

onMounted(async () => {
  window.addEventListener('keydown', onKeyDown)
  try {
    editorData.value = readEditorData()
    await nextTick()
    const canvas = canvasRef.value
    ctx = canvas.getContext('2d')
    image.onload = () => {
      canvas.width = image.width
      canvas.height = image.height
      renderAll()
    }
    image.src = editorData.value.dataUrl
  } catch (error) {
    showToast(error.message || String(error))
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.clearTimeout(toastTimer)
})

watch([color, lineWidth, fontSizePx], updateSelectedStyle)
</script>

<style scoped>
.editor-shell {
  display: flex;
  flex-direction: column;
  min-width: 100vw;
  min-height: 100vh;
  padding-bottom: 18px;
  overflow: hidden;
  background: transparent;
  color: var(--text-primary);
}

.stage {
  position: relative;
  flex: 1;
  margin: 8px auto 0;
  overflow: hidden;
  border-radius: 6px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
}

.capture-canvas {
  display: block;
  background: transparent;
}

.annotation-input {
  position: absolute;
  z-index: 5;
  min-height: 26px;
  max-width: 260px;
  padding: 4px 8px;
  border: 1px solid rgba(22, 119, 255, 0.78);
  border-radius: 6px;
  outline: none;
  font-weight: 650;
  line-height: 1.25;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
  -webkit-app-region: no-drag;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  gap: 6px;
  width: max-content;
  max-width: calc(100vw - 16px);
  height: 50px;
  margin: 4px auto 0;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--toolbar-glass-bg);
  border: 1px solid var(--toolbar-glass-border);
  box-shadow: 0 8px 24px var(--toolbar-glass-shadow);
  backdrop-filter: blur(18px) saturate(1.35);
  -webkit-backdrop-filter: blur(18px) saturate(1.35);
  -webkit-app-region: no-drag;
  white-space: nowrap;
  overflow: visible;
}

.icon-button {
  position: relative;
  display: inline-grid;
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  place-items: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 18px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
}

.icon-button:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.icon-button.active {
  background: var(--tool-active-bg);
  border-color: var(--tool-active-border);
  color: var(--primary-color);
  box-shadow: inset 0 0 0 1px var(--tool-active-border), 0 4px 12px var(--tool-active-shadow);
}

.icon-button.confirm {
  color: var(--primary-color);
}

.icon-button.confirm:hover {
  background: var(--tool-active-bg);
}

.icon-button[data-tooltip]::before,
.icon-button[data-tooltip]::after,
.toolbar-control[data-tooltip]::before,
.toolbar-control[data-tooltip]::after {
  position: absolute;
  left: 50%;
  z-index: 30;
  pointer-events: none;
  opacity: 0;
  transition: opacity 120ms ease, transform 120ms ease;
}

.icon-button[data-tooltip]::before,
.toolbar-control[data-tooltip]::before {
  bottom: calc(100% + 5px);
  width: 8px;
  height: 8px;
  background: var(--tooltip-bg);
  border-right: 1px solid var(--tooltip-border);
  border-bottom: 1px solid var(--tooltip-border);
  content: "";
  transform: translate(-50%, 4px) rotate(45deg);
}

.icon-button[data-tooltip]::after,
.toolbar-control[data-tooltip]::after {
  bottom: calc(100% + 9px);
  max-width: 120px;
  padding: 5px 8px;
  border: 1px solid var(--tooltip-border);
  border-radius: 6px;
  background: var(--tooltip-bg);
  color: var(--tooltip-text);
  content: attr(data-tooltip);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.18);
  transform: translate(-50%, 4px);
}

.icon-button[data-tooltip]:hover::before,
.icon-button[data-tooltip]:hover::after,
.icon-button[data-tooltip]:focus-visible::before,
.icon-button[data-tooltip]:focus-visible::after,
.toolbar-control[data-tooltip]:hover::before,
.toolbar-control[data-tooltip]:hover::after,
.toolbar-control[data-tooltip]:focus-within::before,
.toolbar-control[data-tooltip]:focus-within::after {
  opacity: 1;
}

.icon-button[data-tooltip]:hover::before,
.icon-button[data-tooltip]:focus-visible::before,
.toolbar-control[data-tooltip]:hover::before,
.toolbar-control[data-tooltip]:focus-within::before {
  transform: translate(-50%, 0) rotate(45deg);
}

.icon-button[data-tooltip]:hover::after,
.icon-button[data-tooltip]:focus-visible::after,
.toolbar-control[data-tooltip]:hover::after,
.toolbar-control[data-tooltip]:focus-within::after {
  transform: translate(-50%, 0);
}

.sh-icon {
  display: inline-block;
  width: 20px;
  height: 20px;
  background-color: currentColor;
  -webkit-mask: var(--sh-icon) no-repeat center / 100% 100%;
  mask: var(--sh-icon) no-repeat center / 100% 100%;
}

.sh-icon-undo {
  --sh-icon: url("data:image/svg+xml;utf8,%3Csvg display='inline-block' vertical-align='middle' width='1em' height='1em' xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 48 48'%3E%3Cpath stroke-linejoin='round' stroke-linecap='round' stroke-width='4' stroke='currentColor' d='M11.272 36.728A17.943 17.943 0 0 0 24 42c9.941 0 18-8.059 18-18S33.941 6 24 6c-4.97 0-9.47 2.015-12.728 5.272C9.614 12.93 6 17 6 17' data-follow-stroke='%23333'/%3E%3Cpath stroke-linejoin='round' stroke-linecap='round' stroke-width='4' stroke='%23333' d='M6 9v8h8' data-follow-stroke='%23333'/%3E%3C/svg%3E");
}

.sh-icon-save {
  --sh-icon: url("data:image/svg+xml;utf8,%3Csvg display='inline-block' vertical-align='middle' width='1em' height='1em' xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 48 48'%3E%3Cpath stroke-linejoin='round' stroke-width='4' stroke='currentColor' d='M39.3 6H8.7A2.7 2.7 0 0 0 6 8.7v30.6A2.7 2.7 0 0 0 8.7 42h30.6a2.7 2.7 0 0 0 2.7-2.7V8.7A2.7 2.7 0 0 0 39.3 6Z' data-follow-stroke='%23333'/%3E%3Cpath stroke-linejoin='round' stroke-width='4' stroke='%23333' d='M32 6v18H15V6h17Z' data-follow-stroke='%23333'/%3E%3Cpath stroke-linecap='round' stroke-width='4' stroke='%23333' d='M26 13v4M10.997 6H36' data-follow-stroke='%23333'/%3E%3C/svg%3E");
}

.sh-icon-move {
  --sh-icon: url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48' fill='none'%3E%3Cpath d='M24 4l6 7h-4v11h11v-4l7 6-7 6v-4H26v11h4l-6 7-6-7h4V26H11v4l-7-6 7-6v4h11V11h-4l6-7Z' fill='black'/%3E%3C/svg%3E");
}

.sh-icon-rect {
  --sh-icon: url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48' fill='none'%3E%3Crect x='10' y='12' width='28' height='24' rx='2' stroke='black' stroke-width='5'/%3E%3C/svg%3E");
}

.sh-icon-circle {
  --sh-icon: url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48' fill='none'%3E%3Ccircle cx='24' cy='24' r='15' stroke='black' stroke-width='5'/%3E%3C/svg%3E");
}

.sh-icon-arrow {
  --sh-icon: url("data:image/svg+xml;utf8,%3Csvg display='inline-block' vertical-align='middle' width='1em' height='1em' xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 48 48'%3E%3Cpath stroke-linejoin='round' stroke-linecap='round' stroke-width='4' stroke='currentColor' d='M19 11h18v18M11.544 36.456 37 11' data-follow-stroke='%23333'/%3E%3C/svg%3E");
}

.sh-icon-line {
  --sh-icon: url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48' fill='none'%3E%3Cpath d='M9 24h30' stroke='black' stroke-width='6' stroke-linecap='round'/%3E%3C/svg%3E");
}

.sh-icon-brush {
  --sh-icon: url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Cpath d='M32.5 5.5c2.6-2.6 6.8-2.6 9.3 0 .9.9.9 2.4 0 3.3L22.5 28.1l-7-7L34.8 1.8c.9-.9 2.4-.9 3.3 0l-5.6 3.7Z' fill='black'/%3E%3Cpath d='M13.8 23.2 20.8 30.2C18.2 37 12.4 41.4 4 42c2.9-4.1 3.6-8.4 3.9-12 .2-2.9 2.9-5.7 5.9-6.8Z' fill='black'/%3E%3C/svg%3E");
}

.sh-icon-mosaic {
  --sh-icon: url("data:image/svg+xml;utf8,%3Csvg display='inline-block' vertical-align='middle' width='1em' height='1em' xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 48 48'%3E%3Cpath fill='currentColor' d='M44 36h-8v8h8v-8ZM28 36h-8v8h8v-8ZM12 36H4v8h8v-8ZM44 20h-8v8h8v-8ZM28 20h-8v8h8v-8ZM12 20H4v8h8v-8ZM44 4h-8v8h8V4ZM28 4h-8v8h8V4ZM12 4H4v8h8V4ZM20 12h-8v8h8v-8ZM20 28h-8v8h8v-8ZM36 12h-8v8h8v-8ZM36 28h-8v8h8v-8Z' data-follow-fill='%23333'/%3E%3C/svg%3E");
}

.sh-icon-text {
  --sh-icon: url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Cpath d='M9 9h30v7h-4l-1-3h-7v24l4 1v4H17v-4l4-1V13h-7l-1 3H9V9Z' fill='black'/%3E%3C/svg%3E");
}

.sh-icon-serial {
  --sh-icon: url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48' fill='none'%3E%3Ccircle cx='24' cy='24' r='17' stroke='black' stroke-width='5'/%3E%3Cpath d='M23 34V19l-4 2-2-4 8-4h4v21h-6Z' fill='black'/%3E%3C/svg%3E");
}

.toolbar-control {
  position: relative;
  display: inline-grid;
  align-items: center;
  -webkit-app-region: no-drag;
}

.divider {
  width: 1px;
  height: 22px;
  background: var(--border-color);
}

.swatch {
  width: 32px;
  height: 32px;
  place-items: center;
}

.swatch input {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  background: transparent;
}

.size-control {
  grid-auto-flow: column;
  grid-auto-columns: max-content;
  gap: 3px;
  height: 32px;
  padding: 0 6px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-app);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 650;
}

.size-input {
  width: 34px;
  height: 30px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  text-align: center;
  font: inherit;
  outline: none;
}

.editor-toast {
  position: fixed;
  left: 50%;
  bottom: 60px;
  transform: translateX(-50%);
  padding: 8px 12px;
  border-radius: 7px;
  background: var(--toast-bg);
  color: var(--toast-text);
  font-size: 13px;
}
</style>
