<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'

/**
 * 截图识别结果展示窗口（由 ztools.createBrowserWindow 打开，纯展示，无边框）。
 *
 * 数据来源：主窗口在「截图 + OCR」完成后，通过
 *   win.webContents.executeJavaScript('window.__loadScreenOcrResult({...})')
 * 把 { image, lines, isDark, scaleFactor } 注入本窗口；本组件接收后渲染。
 *
 * 布局：自绘标题栏（可拖动 + 关闭按钮）+ 左图右文。
 *   - 标题栏：无边框窗口顶部自绘，-webkit-app-region: drag 实现拖动，右上角关闭按钮。
 *   - 左侧（图区）：1:1 展示截图底图（canvas 按原图自然像素绘制，CSS 控制显示尺寸），
 *     上叠透明文字层（按坐标百分比定位，贴合识别位置，与原 ScreenOcr/OcrImageViewer 一致）。
 *     图片可自由拖动 + 滚轮缩放（以鼠标为锚点），按钮放大/缩小/复位/1:1。
 *   - 右侧（结果区）：识别明细列表，hover 与图上文字双向高亮联动。
 *   - 交互：悬停图上文字 → 右侧列表定位到该行并高亮；点击图上文字 → 复制该行文字。
 *
 * 窗口大小不固定（由主窗口按屏幕大小 + 系统缩放计算）；本视图自适应。
 */

// ─── 注入数据 ─────────────────────────────────────────────────────────
const image = ref('')
const lines = ref<OcrLine[]>([])
const loading = ref(true)
const errorText = ref('')
/** 系统缩放（devicePixelRatio），用于 canvas 1:1 渲染。 */
const scaleFactor = ref(1)
/** 插件 logo data URI（标题栏左侧展示）。 */
const logo = ref('')

function applyTheme(isDark: boolean) {
  const root = document.documentElement
  root.classList.toggle('dark', isDark)
}

function loadData(data: {
  image?: string
  lines?: OcrLine[]
  isDark?: boolean
  loading?: boolean
  error?: string
  scaleFactor?: number
  logo?: string
}) {
  if (typeof data.image === 'string') image.value = data.image
  if (Array.isArray(data.lines)) lines.value = data.lines
  if (typeof data.isDark === 'boolean') applyTheme(data.isDark)
  if (typeof data.loading === 'boolean') loading.value = data.loading
  if (typeof data.error === 'string') errorText.value = data.error
  if (typeof data.scaleFactor === 'number' && data.scaleFactor > 0) {
    scaleFactor.value = data.scaleFactor
  }
  if (typeof data.logo === 'string') logo.value = data.logo
  if (data.image) nextTick(loadImage)
}

// 主窗口注入入口
;(window as any).__loadScreenOcrResult = loadData

// ─── 关闭窗口（无边框窗口自绘关闭按钮） ───────────────────────────────
// 子窗口内 window.close() 会被 Electron BrowserWindow 响应（关闭该窗口）。
function closeWindow() {
  try {
    window.close()
  } catch (_) {
    /* ignore */
  }
}

// ─── 复制（子窗口无 window.ztools，走 navigator.clipboard 兜底 + 选中提示） ───
const copied = ref('')
let copiedTimer: number | null = null
function copyText(text: string) {
  if (!text) return
  try {
    navigator.clipboard?.writeText(text)
  } catch (_) {
    /* 子窗口可能无 clipboard 权限，静默失败 */
  }
  copied.value = text
  if (copiedTimer) window.clearTimeout(copiedTimer)
  copiedTimer = window.setTimeout(() => (copied.value = ''), 1200)
}

function copyAll() {
  if (!plainText.value) return
  copyText(plainText.value)
}

// ─── canvas 绘图（自然像素） ────────────────────────────────────────────
const canvasRef = ref<HTMLCanvasElement | null>(null)
const viewportRef = ref<HTMLDivElement | null>(null)
const naturalWidth = ref(0)
const naturalHeight = ref(0)
const stageRef = ref<HTMLDivElement | null>(null)
let lastImg: HTMLImageElement | null = null

function loadImage() {
  if (!image.value) return
  const img = new Image()
  img.onload = () => {
    naturalWidth.value = img.naturalWidth
    naturalHeight.value = img.naturalHeight
    lastImg = img
    nextTick(() => {
      drawToCanvas(img)
      // 初次加载按「适应窗口」展示（不一定是 1:1），避免大图溢出
      fitView()
    })
  }
  img.src = image.value
}

/**
 * 计算「适应窗口」的缩放比：使图片完整可见（contain）。
 * 图片自然像素 vs 视口 CSS 像素（已与窗口 DIP 一致）。
 */
function computeFitScale(): number {
  const vp = viewportRef.value
  const vw = vp ? vp.clientWidth : window.innerWidth
  const vh = vp ? vp.clientHeight : window.innerHeight
  if (!naturalWidth.value || !naturalHeight.value || !vw || !vh) return 1
  // 留 16px 内边距
  const aw = vw - 16
  const ah = vh - 16
  return Math.min(aw / naturalWidth.value, ah / naturalHeight.value, 1)
}

/**
 * 计算使缩放后的图片在视口内居中的偏移量。
 * stage 用 transform-origin: 0 0，缩放后尺寸 = natural * scale，
 * 居中偏移 = (视口尺寸 - 缩放后尺寸) / 2。
 */
function computeCenterOffset(s: number): { x: number; y: number } {
  const vp = viewportRef.value
  const vw = vp ? vp.clientWidth : window.innerWidth
  const vh = vp ? vp.clientHeight : window.innerHeight
  const scaledW = naturalWidth.value * s
  const scaledH = naturalHeight.value * s
  return {
    x: Math.round((vw - scaledW) / 2),
    y: Math.round((vh - scaledH) / 2)
  }
}

/** 适应窗口：缩放到 contain，并把图片居中。 */
function fitView() {
  const s = computeFitScale()
  scale.value = s
  const center = computeCenterOffset(s)
  offsetX.value = center.x
  offsetY.value = center.y
}

function drawToCanvas(img: HTMLImageElement) {
  const canvas = canvasRef.value
  if (!canvas) return
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
}

watch(image, (src) => {
  if (src) loadImage()
  else {
    naturalWidth.value = 0
    naturalHeight.value = 0
    lastImg = null
  }
})

// ─── 透明文字层（百分比定位，贴合识别位置） ─────────────────────────────
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
  lines.value.map((l) => ({
    text: l.text,
    rate: l.rate,
    left: pct(l.left, naturalWidth.value),
    top: pct(l.top, naturalHeight.value),
    width: pct(l.right - l.left, naturalWidth.value),
    height: pct(l.bottom - l.top, naturalHeight.value)
  }))
)

const hasResult = computed(() => lines.value.length > 0)
const plainText = computed(() => lines.value.map((l) => l.text).join('\n'))

// 列表 ↔ 图片 双向高亮
const hoveredIndex = ref<number | null>(null)
// 选中（点击）的行索引：点击图上文字或列表行时置位，对应行持续高亮 + 列表滚动可视。
const activeIndex = ref<number | null>(null)
// 闪烁标记：点击图上文字复制后，用 id 标记该行闪烁高亮（递增避免重复定时器冲突）。
const flashedIds = ref<number[]>([])
// 右侧列表容器引用，用于滚动到对应行
const resultListRef = ref<HTMLDivElement | null>(null)

/**
 * 让右侧列表定位到第 i 行：置 activeIndex 高亮并滚动可视。
 * 由「悬停图上文字」「点击图上文字」触发。
 */
function selectLine(i: number): void {
  activeIndex.value = i
  nextTick(() => {
    const list = resultListRef.value
    if (!list) return
    const el = list.children[i] as HTMLElement | undefined
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  })
}

/**
 * 悬停图上文字：右侧列表跳转到该行并高亮（仅高亮，不复制）。
 */
function onOverlayHover(i: number): void {
  hoveredIndex.value = i
  const list = resultListRef.value
  if (!list) return
  const el = list.children[i] as HTMLElement | undefined
  if (el) {
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
}

/**
 * 点击图上文字：若是拖动结束（didDrag）则不触发，避免拖图误复制；
 * 否则复制该行文字并闪烁高亮反馈。
 */
function onOverlayClick(i: number): void {
  if (didDrag) {
    didDrag = false
    return
  }
  flashLine(i)
  copyText(lines.value[i]?.text ?? '')
}

/** 触发第 i 行的闪烁高亮（图上 + 列表），1.5s 后移除。 */
function flashLine(i: number): void {
  activeIndex.value = i
  const id = (flashedIds.value[i] ?? 0) + 1
  flashedIds.value[i] = id
  window.setTimeout(() => {
    if (flashedIds.value[i] === id) flashedIds.value[i] = 0
  }, 1500)
}

// ─── 拖动 + 缩放（以 CSS transform 实现，不重绘 canvas） ─────────────────
// stage 为承载 canvas + overlay 的容器，translate + scale 控制其位置与缩放。
// scale 基准 = 1:1（canvas 的 CSS 显示尺寸 = 自然像素 * devicePixelRatio 归一）。
const scale = ref(1)
const offsetX = ref(0)
const offsetY = ref(0)
const dragging = ref(false)
let pointerActive = false
let dragStart = { x: 0, y: 0 }
let dragOrigin = { x: 0, y: 0 }

// CSS 显示尺寸：1:1 时等于自然像素。本视图默认 1:1 展示（不缩放到底图适配窗口），
// 由用户拖动/缩放自由查看；窗口大小由主窗口按屏幕大小设定。
const stageStyle = computed(() => ({
  width: naturalWidth.value ? naturalWidth.value + 'px' : 'auto',
  height: naturalHeight.value ? naturalHeight.value + 'px' : 'auto',
  transform: `translate(${offsetX.value}px, ${offsetY.value}px) scale(${scale.value})`
}))

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const vp = viewportRef.value
  if (!vp || !naturalWidth.value) return
  // stage 用 transform-origin: 0 0，其未变换左上角在视口内的位置 = (offsetX, offsetY)。
  // 鼠标相对视口的坐标 mx/my，对应的「stage 未变换坐标」= (mx - offsetX) / scale。
  const vpRect = vp.getBoundingClientRect()
  const mx = e.clientX - vpRect.left
  const my = e.clientY - vpRect.top

  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
  const next = Math.min(8, Math.max(0.1, scale.value * factor))
  // 锚点保持：缩放后鼠标点仍指向原图同一位置
  // newOffset = mx - pointUnscaled * next，其中 pointUnscaled = (mx - offset) / scale
  const pointX = (mx - offsetX.value) / scale.value
  const pointY = (my - offsetY.value) / scale.value
  offsetX.value = mx - pointX * next
  offsetY.value = my - pointY * next
  scale.value = next
}

const DRAG_THRESHOLD = 4
// 标记「本次按下是否真的发生了拖动」：用于在 click 时判断要不要触发选中。
// 拖动过则不触发（避免拖图结束时误选文字）。
let didDrag = false
function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  pointerActive = true
  didDrag = false
  dragStart = { x: e.clientX, y: e.clientY }
  dragOrigin = { x: offsetX.value, y: offsetY.value }
}
function onPointerMove(e: PointerEvent) {
  if (!pointerActive) return
  const dx = e.clientX - dragStart.x
  const dy = e.clientY - dragStart.y
  if (!dragging.value && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
  if (!dragging.value) {
    dragging.value = true
    didDrag = true
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  offsetX.value = dragOrigin.x + dx
  offsetY.value = dragOrigin.y + dy
}
function onPointerUp(e: PointerEvent) {
  pointerActive = false
  if (dragging.value) {
    dragging.value = false
    ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
  }
}

function zoomBy(factor: number) {
  const next = Math.min(8, Math.max(0.1, scale.value * factor))
  scale.value = next
}

/** 1:1 复位：缩放到 100%（原始像素），偏移归零。 */
function resetView() {
  scale.value = 1
  offsetX.value = 0
  offsetY.value = 0
}

// ─── 生命周期 ─────────────────────────────────────────────────────────
function onWinResize() {
  // 窗口尺寸变化时，若当前是适应态则重算；用户已手动缩放则保持
  if (scale.value <= computeFitScale() + 0.001) {
    fitView()
  }
}

onMounted(() => {
  // 滚轮缩放绑定在视口（固定大小区域）而非 stage（会随 scale 缩小命中区），
  // 这样鼠标在图片区的任意位置（含 fit 后的留白）滚轮都能缩放。
  const vp = viewportRef.value
  if (vp) {
    vp.addEventListener('wheel', onWheel, { passive: false })
  }
  window.addEventListener('resize', onWinResize)
})

onUnmounted(() => {
  const vp = viewportRef.value
  if (vp) vp.removeEventListener('wheel', onWheel)
  window.removeEventListener('resize', onWinResize)
  if (copiedTimer) window.clearTimeout(copiedTimer)
})
</script>

<template>
  <div class="result-window">
    <!-- 自绘标题栏（无边框窗口）：图标 + 标题，可拖动 + 右上角关闭按钮 -->
    <header class="title-bar">
      <div class="title-left">
        <img v-if="logo" class="title-logo" :src="logo" alt="" draggable="false" />
        <span class="title-text">截图识别结果</span>
      </div>
      <button
        type="button"
        class="close-btn"
        title="关闭"
        aria-label="关闭"
        @click="closeWindow"
      >
        ✕
      </button>
    </header>

    <div class="body">
      <!-- 左侧：图片区（适应窗口展示 + 透明文字层 + 拖动缩放） -->
      <div class="pane pane-image">
        <div ref="viewportRef" class="viewport" :class="{ 'is-dragging': dragging }">
        <div
          v-if="image"
          ref="stageRef"
          class="stage"
          :style="stageStyle"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        >
          <canvas ref="canvasRef" class="stage-canvas"></canvas>
          <!-- 透明文字层：按百分比定位，贴合识别位置 -->
          <div v-if="hasResult" class="overlay">
            <div
              v-for="(o, i) in overlays"
              :key="i"
              class="overlay-line"
              :class="{
                active: hoveredIndex === i || activeIndex === i,
                flash: !!flashedIds[i]
              }"
              :style="{
                left: o.left + '%',
                top: o.top + '%',
                width: o.width + '%',
                height: o.height + '%'
              }"
              @mouseenter="onOverlayHover(i)"
              @mouseleave="hoveredIndex = null"
              @click="onOverlayClick(i)"
            >
              <span class="overlay-text">{{ o.text }}</span>
            </div>
          </div>
        </div>
        <div v-else-if="loading" class="state-hint">识别中…</div>
        <div v-else-if="errorText" class="state-hint error">{{ errorText }}</div>
        <div v-else class="state-hint">无图片</div>
      </div>

      <!-- 图片工具栏 -->
      <div v-if="image" class="img-toolbar">
        <button type="button" class="tool-btn" title="缩小" @click="zoomBy(1 / 1.2)">−</button>
        <span class="zoom-text">{{ Math.round(scale * 100) }}%</span>
        <button type="button" class="tool-btn" title="放大" @click="zoomBy(1.2)">+</button>
        <button type="button" class="tool-btn" title="适应窗口" @click="fitView">适应</button>
        <button type="button" class="tool-btn reset-btn" title="1:1 原始尺寸" @click="resetView">
          1:1
        </button>
      </div>
    </div>

      <!-- 右侧：识别结果列表 -->
      <div class="pane pane-result">
        <header class="result-head">
          <span class="result-title">识别结果<span v-if="hasResult">（{{ lines.length }} 行）</span></span>
          <div class="result-actions">
            <span v-if="copied" class="copied-tip">已复制</span>
            <button v-if="hasResult" type="button" class="copy-all-btn" @click="copyAll">
              复制全部
            </button>
          </div>
        </header>

        <div v-if="loading && !hasResult" class="result-empty">识别中…</div>
        <div v-else-if="errorText" class="result-empty error">{{ errorText }}</div>
        <div v-else-if="!hasResult" class="result-empty">未识别到文字</div>
        <div v-else ref="resultListRef" class="result-list">
          <div
            v-for="(line, i) in lines"
            :key="i"
            class="result-line"
            :class="{
              active: hoveredIndex === i || activeIndex === i,
              flash: !!flashedIds[i]
            }"
            @mouseenter="hoveredIndex = i"
            @mouseleave="hoveredIndex = null"
            @click="selectLine(i)"
          >
            <span class="result-rate">{{ (line.rate * 100).toFixed(0) }}%</span>
            <span class="result-text" @mousedown.stop>{{ line.text }}</span>
          </div>
        </div>
        <footer v-if="hasResult" class="result-footer">
          悬停图上文字可定位高亮；点击图上文字可复制；图片可拖动、滚轮缩放
        </footer>
      </div>
    </div>
    <!-- /.body -->
  </div>
</template>

<style scoped>
/* 整窗：列布局（标题栏在上，主体在下） */
.result-window {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

/* ── 自绘标题栏（无边框窗口） ── */
/* -webkit-app-region: drag 让该区域可拖动窗口；按钮需设 no-drag 才能点击 */
.title-bar {
  flex: 0 0 auto;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 0 16px;
  -webkit-app-region: drag;
  user-select: none;
  background: var(--titlebar-bg, rgba(0, 0, 0, 0.04));
  border-bottom: 1px solid var(--border-color, rgba(128, 128, 128, 0.18));
}

.title-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.title-logo {
  width: 20px;
  height: 20px;
  object-fit: contain;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
  pointer-events: none;
}

.title-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, inherit);
}

.close-btn {
  -webkit-app-region: no-drag;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.close-btn:hover {
  background: rgba(229, 57, 53, 0.85);
  color: #fff;
}

/* ── 主体：左右分栏（图片区弹性占满，结果区固定宽度并独立滚动） ── */
.body {
  flex: 1 1 auto;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

.pane-image {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0; /* flex 子项默认 min-height:auto 会让内容撑开，导致工具栏被挤出 */
  display: flex;
  flex-direction: column;
  background: var(--img-bg, #1e1e1e);
  position: relative;
}

/* 视口：图片区内部可滚动/裁剪，承载变换后的 stage */
.viewport {
  flex: 1 1 auto;
  min-height: 0; /* 允许收缩，给工具栏留空间 */
  overflow: hidden;
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  cursor: grab;
  /* 让大图初始可从左上角开始看 */
  padding: 0;
}

.viewport.is-dragging {
  cursor: grabbing;
}

/* stage：承载 canvas + overlay，尺寸为自然像素（1:1）；
   transform 控制 translate + scale，拖动缩放只改 transform 不重绘 canvas */
.stage {
  position: relative;
  flex: 0 0 auto;
  transform-origin: 0 0;
  line-height: 0;
  touch-action: none;
  user-select: none;
}

.stage-canvas {
  display: block;
  width: 100%;
  height: 100%;
  user-select: none;
}

/* 透明文字层：贴合识别位置 */
.overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.overlay-line {
  position: absolute;
  box-sizing: border-box;
  pointer-events: auto;
  border-radius: 2px;
  background: transparent;
  transition: background 0.12s, box-shadow 0.12s;
  cursor: pointer;
  overflow: hidden;
}

.overlay-line.active {
  background: rgba(25, 118, 210, 0.18);
  box-shadow: 0 0 0 1px rgba(25, 118, 210, 0.7) inset;
}

.overlay-line.flash {
  background: rgba(76, 175, 80, 0.35);
  box-shadow: 0 0 0 1px rgba(76, 175, 80, 0.8) inset;
}

.overlay-text {
  font-size: 0.9em;
  line-height: 1.1;
  color: transparent; /* 透明：能看到底图，又可被鼠标点中 */
  user-select: text;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
  display: block;
  padding: 0 1px;
}

.state-hint {
  margin: auto;
  color: var(--text-secondary, #999);
  font-size: 14px;
}

.state-hint.error {
  color: #e53935;
}

/* 图片工具栏 */
.img-toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px;
  background: var(--toolbar-bg, rgba(0, 0, 0, 0.04));
  border-top: 1px solid #454545;
}

.tool-btn {
  min-width: 30px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid #454545;
  border-radius: 6px;
  background: var(--btn-bg, rgba(255, 255, 255, 0.08));
  color: #fff;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s;
}

.tool-btn:hover {
  background: var(--btn-hover-bg, rgba(128, 128, 128, 0.2));
}

.reset-btn {
  font-size: 12px;
}

.zoom-text {
  min-width: 48px;
  text-align: center;
  font-size: 12px;
  color: var(--text-secondary, #999);
}

/* 右侧结果区 */
.pane-result {
  flex: 0 0 360px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-left: 1px solid var(--border-color, rgba(128, 128, 128, 0.2));
  background: var(--pane-bg, transparent);
}

.result-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--border-color, rgba(128, 128, 128, 0.15));
}

.result-title {
  font-size: 14px;
  font-weight: 600;
}

.result-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.copied-tip {
  font-size: 11px;
  color: #4caf50;
}

.copy-all-btn {
  border: 1px solid var(--border-color, rgba(128, 128, 128, 0.3));
  border-radius: 6px;
  background: var(--btn-bg, rgba(128, 128, 128, 0.1));
  color: inherit;
  font-size: 12px;
  padding: 4px 10px;
  cursor: pointer;
  transition: background 0.15s;
}

.copy-all-btn:hover {
  background: var(--btn-hover-bg, rgba(128, 128, 128, 0.22));
}

.result-list {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.result-empty {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary, #999);
  font-size: 14px;
  padding: 24px;
  text-align: center;
}

.result-empty.error {
  color: #e53935;
}

.result-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 14px;
  line-height: 1.5;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s;
}

.result-line:hover,
.result-line.active {
  background: var(--hover-bg, rgba(128, 128, 128, 0.12));
}

.result-line.flash {
  background: rgba(76, 175, 80, 0.2);
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

.result-footer {
  flex: 0 0 auto;
  padding: 8px 16px;
  font-size: 11px;
  color: var(--text-secondary, #999);
  border-top: 1px solid var(--border-color, rgba(128, 128, 128, 0.15));
}
</style>

<!-- 全局样式兜底：子窗口由 createBrowserWindow 打开，无 main.css 的 html/body 重置可能不生效，
     此处用非 scoped 的 :deep 不适用于根元素，故补充全局样式。 -->
<style>
html,
body {
  margin: 0;
  padding: 0;
  height: 100%;
  overflow: hidden;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC',
    'Microsoft YaHei', sans-serif;
}
#app {
  height: 100vh;
}
</style>
