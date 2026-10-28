<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ClipboardRecord } from '../types'
import { resolveImageSrc } from '../utils/image'
import { relTime } from '../utils/format'
import {
  DBLCLICK_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  STEP_ZOOM,
  actualZoom,
  canPan,
  clampOffset,
  fitSize,
  clampZoom,
  wheelDelta,
  zoomAt,
  zoomByWheel,
} from '../utils/zoom'

/**
 * 全屏图片预览层（可缩放）。
 * 键盘：Esc 关闭 / ←→ 切换 / Enter 复制 / + - 缩放 / 0 复原 / 1 原始像素；点击背景关闭。
 * 鼠标：滚轮缩放（以光标为锚点）/ 按住拖动平移 / 双击在「适应」与 2 倍间切换。
 *
 * 缩放/平移的数学都在 utils/zoom.ts（可单测）。这里只负责把状态接到 DOM 上。
 */
const props = defineProps<{
  /** 当前记录（保证是 image 类型） */
  record: ClipboardRecord
  /** 当前是过滤结果中第几张图片 */
  index: number
  /** 过滤结果中图片总数 */
  total: number
}>()

const emit = defineEmits<{
  close: []
  prev: []
  next: []
  copy: [record: ClipboardRecord]
}>()

const failed = ref(false)
const loaded = ref(false)

/* ---------- 缩放 / 平移状态 ---------- */

const stageEl = ref<HTMLElement | null>(null)
const imgEl = ref<HTMLImageElement | null>(null)

/** 1 = 适应窗口（CSS 的 max-width/max-height 已经把图片缩到这么大） */
const zoom = ref(1)
const offset = ref({ x: 0, y: 0 })
/** 图片"适应窗口"后的布局尺寸（不含 transform） */
const base = ref({ w: 0, h: 0 })
/** 舞台可用区域（扣掉左右让位给切换按钮的 padding） */
const stage = ref({ w: 0, h: 0 })
/** 图片的真实像素（读不到就退化成宿主记录的 resolution） */
const natural = ref({ w: 0, h: 0 })

const dragging = ref(false)
/** 这次按下有没有真的拖动过 —— 拖完松手不能当成"点背景关闭" */
let moved = false
let startX = 0
let startY = 0
let startOffset = { x: 0, y: 0 }

const pannable = computed(() => canPan(zoom.value, base.value, stage.value))
const percent = computed(() => Math.round(zoom.value * 100))

/** 正好"一个图片像素占一个屏幕像素"时的倍率（1:1 按钮就是跳到这里） */
const actualRatio = computed(() =>
  natural.value.w && base.value.w ? actualZoom(natural.value.w, base.value.w) : 0
)

/**
 * 已经放到超过原始像素了 —— 再放大只会把像素摊得更大，不会更清楚。
 * 这条必须让用户看见：很多人以为"放得越大越清楚"，其实是到这里为止。
 */
const beyondActual = computed(
  () => actualRatio.value > 0 && zoom.value > actualRatio.value + 0.005
)

const zoomTitle = computed(() =>
  beyondActual.value
    ? `已超过原始像素 ${natural.value.w} × ${natural.value.h}（再放大也不会更清晰）· 点击恢复适应窗口 (0)`
    : '恢复适应窗口 (0)'
)

/**
 * 图片样式。**缩放绝不能用 `transform: scale()`** —— 那样浏览器只是把"适应窗口"时
 * 已经光栅化好的那张位图拉大（尤其被 will-change 提升成合成层后，光栅倍率被锁死），
 * 放大出来必然是糊的。用户反馈"同样的图复制到别的软件放大是清晰的"就是这个原因。
 *
 * 改成按**真实布局尺寸**渲染（width/height = 基准 × 倍率）：浏览器会按目标尺寸重新采样，
 * 矢量图更是重新光栅化 —— 放多大就多清楚。平移仍然走 transform（位移不影响清晰度）。
 */
const imgStyle = computed(() => {
  const t = `translate(${offset.value.x}px, ${offset.value.y}px)`
  const b = base.value
  // 还没量到基准（首帧）：让 CSS 的 max-width/max-height 先兜着
  if (!b.w || !b.h) return { transform: t }
  return {
    width: `${b.w * zoom.value}px`,
    height: `${b.h * zoom.value}px`,
    // 不解除上限的话，放大后的 width 会被 CSS 的 max-width:100% 重新压回适应尺寸
    maxWidth: 'none',
    maxHeight: 'none',
    transform: t,
  }
})

watch(
  () => props.record.id,
  () => {
    failed.value = false
    loaded.value = false
    // 换一张图必须回到初始视图，否则上一张的放大倍数/位移会带过来
    zoom.value = 1
    offset.value = { x: 0, y: 0 }
    base.value = { w: 0, h: 0 }
    natural.value = { w: 0, h: 0 }
  }
)

const src = computed(() => resolveImageSrc(props.record.content))
const hasSrc = computed(() => !!src.value)

const metaLine = computed(() => {
  const parts: string[] = []
  // 实际读到的像素优先：宿主记的 resolution 可能与真实文件不一致
  if (natural.value.w && natural.value.h) parts.push(`${natural.value.w} × ${natural.value.h}`)
  else {
    const m = props.record.resolution?.match(/^(\d+)\s*\*\s*(\d+)$/)
    if (m) parts.push(`${m[1]} × ${m[2]}`)
  }
  if (props.record.appName) parts.push('来自 ' + props.record.appName)
  const t = relTime(props.record.createdAt)
  if (t) parts.push(t)
  return parts.join(' · ')
})

/* ---------- 度量 ---------- */

function measure(): void {
  const el = stageEl.value
  if (el) {
    const cs = getComputedStyle(el)
    stage.value = {
      w: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
      h: el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
    }
  }
  // 基准尺寸一律按"原始像素等比塞进舞台"算，不能读 offsetWidth ——
  // 布局尺寸现在随缩放变化（缩放走 width，见 imgStyle），读了就变成"越量越大"。
  const img = imgEl.value
  if (img?.naturalWidth && stage.value.w > 0) {
    natural.value = { w: img.naturalWidth, h: img.naturalHeight }
    base.value = fitSize({ w: img.naturalWidth, h: img.naturalHeight }, stage.value)
  } else if (img && zoom.value === 1 && img.offsetWidth > 0) {
    // 拿不到原始像素的极端情况（如无固有尺寸的 SVG）：只在未缩放时布局尺寸才等于基准
    base.value = { w: img.offsetWidth, h: img.offsetHeight }
  }
  // 舞台变了（窗口缩放、图片换源）之后，旧的位移可能已经越界
  offset.value = clampOffset(offset.value, zoom.value, base.value, stage.value)
}

let ro: ResizeObserver | null = null

onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined' && stageEl.value) {
    ro = new ResizeObserver(() => measure())
    ro.observe(stageEl.value)
  }
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('keydown', onKeyDown)
})

function onImgLoad(): void {
  loaded.value = true
  // 基准尺寸取自 naturalWidth（load 后立刻可用，与元素是否可见无关），
  // 所以这里不需要等一帧 —— 但舞台尺寸可能还没定，measure 里会兜住。
  measure()
}

function onImgError(): void {
  failed.value = true
}

/* ---------- 缩放 ---------- */

/** 统一入口：换倍率 → 按锚点算新位移 → 夹取边界 */
function setZoom(next: number, mx = 0, my = 0): void {
  const z = clampZoom(next)
  offset.value = clampOffset(zoomAt(offset.value, zoom.value, z, mx, my), z, base.value, stage.value)
  zoom.value = z
}

function resetZoom(): void {
  zoom.value = 1
  offset.value = { x: 0, y: 0 }
}

function onWheel(e: WheelEvent): void {
  if (!hasSrc.value || failed.value) return
  // 不拦下来，滚到底/顶时事件会冒泡成页面滚动
  e.preventDefault()
  const next = zoomByWheel(zoom.value, wheelDelta(e))
  if (next === zoom.value) return
  const rect = stageEl.value?.getBoundingClientRect()
  if (!rect) return
  // 锚点换算成"以舞台中心为原点"的坐标
  setZoom(next, e.clientX - (rect.left + rect.width / 2), e.clientY - (rect.top + rect.height / 2))
}

function stepZoom(mul: number): void {
  setZoom(zoom.value * mul)
}

function zoomOneToOne(): void {
  const nw = imgEl.value?.naturalWidth ?? 0
  setZoom(actualZoom(nw, base.value.w))
}

function toggleZoom(): void {
  if (zoom.value !== 1) resetZoom()
  else setZoom(DBLCLICK_ZOOM)
}

/* ---------- 拖动平移 ---------- */

function onMouseDown(e: MouseEvent): void {
  if (e.button !== 0 || !pannable.value) return
  dragging.value = true
  moved = false
  startX = e.clientX
  startY = e.clientY
  startOffset = { ...offset.value }
}

function onMouseMove(e: MouseEvent): void {
  if (!dragging.value) return
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  // 3px 之内算点击的抖动，不算拖动
  if (Math.abs(dx) + Math.abs(dy) > 3) moved = true
  offset.value = clampOffset(
    { x: startOffset.x + dx, y: startOffset.y + dy },
    zoom.value,
    base.value,
    stage.value
  )
}

function onMouseUp(): void {
  if (!dragging.value) return
  dragging.value = false
  // moved 留着给紧随其后的 click 判断，下一帧再清（click 在 mouseup 之后同步派发）
  requestAnimationFrame(() => {
    moved = false
  })
}

/** 只有真的没拖动过，点背景才是"关闭" */
function onStageClick(): void {
  if (moved) return
  emit('close')
}

/* ---------- 键盘 ---------- */

function onKeyDown(e: KeyboardEvent): void {
  switch (e.key) {
    case '+':
    case '=':
      e.preventDefault()
      stepZoom(STEP_ZOOM)
      break
    case '-':
    case '_':
      e.preventDefault()
      stepZoom(1 / STEP_ZOOM)
      break
    case '0':
      e.preventDefault()
      resetZoom()
      break
    case '1':
      e.preventDefault()
      zoomOneToOne()
      break
  }
}
</script>

<template>
  <teleport to="body">
    <div class="preview-mask">
      <!-- 顶栏：计数 + 缩放 + 操作 -->
      <div class="preview-top">
        <span class="counter">{{ index + 1 }} / {{ total }}</span>

        <div class="zoom-bar">
          <button
            class="btn icon"
            :disabled="zoom <= MIN_ZOOM"
            title="缩小 (-)"
            @click="stepZoom(1 / STEP_ZOOM)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke-width="1.9" stroke-linecap="round">
              <path d="M6 12h12" stroke="currentColor" />
            </svg>
          </button>
          <button
            class="btn pct"
            :class="{ over: beyondActual }"
            :title="zoomTitle"
            @click="resetZoom"
          >
            {{ percent }}%
          </button>
          <button
            class="btn icon"
            :disabled="zoom >= MAX_ZOOM"
            title="放大 (+)"
            @click="stepZoom(STEP_ZOOM)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke-width="1.9" stroke-linecap="round">
              <path d="M12 6v12M6 12h12" stroke="currentColor" />
            </svg>
          </button>
          <button
            class="btn"
            :title="actualRatio ? `按原始像素显示 (1) · ${Math.round(actualRatio * 100)}%` : '按原始像素显示 (1)'"
            @click="zoomOneToOne"
          >
            1:1
          </button>
        </div>

        <div class="top-right">
          <button class="btn" title="复制这张图片 (Enter)" @click="emit('copy', record)">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round"
              stroke-linejoin="round">
              <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" />
              <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" />
            </svg>
            <span>复制</span>
          </button>
          <button class="btn icon" title="关闭 (Esc)" @click="emit('close')">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" />
            </svg>
          </button>
        </div>
      </div>

      <!-- 主体：图片 / 加载中 / 失败占位 -->
      <div
        ref="stageEl"
        class="preview-stage"
        :class="{ pannable, grabbing: dragging }"
        @click.self="onStageClick"
        @wheel="onWheel"
        @mousedown="onMouseDown"
      >
        <template v-if="hasSrc && !failed">
          <img
            ref="imgEl"
            v-show="loaded"
            class="preview-img"
            :src="src"
            :style="imgStyle"
            draggable="false"
            alt=""
            @load="onImgLoad"
            @error="onImgError"
            @dblclick="toggleZoom"
          />
          <div v-if="!loaded" class="preview-loading">加载中…</div>
        </template>
        <div v-else class="preview-fallback">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.2" stroke-linecap="round"
            stroke-linejoin="round">
            <path d="M3 5h18v14H3zM3 15l5-4 4 3 3-2 6 5M15.5 9.5a1 1 0 1 0 0-.01" stroke="currentColor" />
          </svg>
          <p>{{ record.preview || '图片加载失败' }}</p>
        </div>

        <!-- 左右切换 -->
        <button v-if="total > 1" class="nav nav-prev" title="上一张 (←)" @click.stop="emit('prev')">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"
            stroke-linejoin="round">
            <path d="M15 5l-7 7 7 7" stroke="currentColor" />
          </svg>
        </button>
        <button v-if="total > 1" class="nav nav-next" title="下一张 (→)" @click.stop="emit('next')">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"
            stroke-linejoin="round">
            <path d="M9 5l7 7-7 7" stroke="currentColor" />
          </svg>
        </button>
      </div>

      <!-- 底栏：元信息 + 快捷键提示 -->
      <div class="preview-bottom">
        <span class="meta">{{ metaLine }}</span>
        <span class="hint">滚轮缩放 · 拖动平移 · 双击复原 · Esc 关闭 · ← → 切换 · Enter 复制</span>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.preview-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  background: rgba(10, 12, 16, 0.82);
  backdrop-filter: blur(6px);
  animation: fade-in 0.15s ease-out;
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.preview-top {
  flex: none;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  color: rgba(255, 255, 255, 0.85);
}

.counter {
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}

.zoom-bar {
  display: flex;
  align-items: center;
  gap: 6px;
}

.top-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border: none;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.12s, opacity 0.12s;
}

.btn:hover { background: rgba(255, 255, 255, 0.2); }
.btn:disabled { opacity: 0.35; cursor: default; }
.btn:disabled:hover { background: rgba(255, 255, 255, 0.1); }
.btn svg { width: 15px; height: 15px; }

.btn.icon { padding: 0; width: 30px; justify-content: center; }

/* 等宽数字：不然 99% → 100% 会让整排按钮抖一下 */
.btn.pct {
  min-width: 56px;
  justify-content: center;
  font-variant-numeric: tabular-nums;
}

/* 放到超过原始像素了：再放大也不会更清楚，给个颜色提醒一下 */
.btn.pct.over { color: #ffd479; }

.preview-stage {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 56px;
  /* 放大后图片必须被裁在这一层里，否则会盖住顶栏/底栏 */
  overflow: hidden;
  user-select: none;
}

.preview-stage.pannable { cursor: grab; }
.preview-stage.grabbing { cursor: grabbing; }

.preview-img {
  max-width: 100%;
  max-height: 100%;
  border-radius: 8px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
  /* 关键帧里绝不能出现 transform —— 会和内联的 translate 打架（见 MEMORY 硬规矩 1） */
  animation: img-in 0.18s ease-out;
  transform-origin: center center;
  /*
    不要加 will-change: transform！它会把图片提升成合成层并锁定光栅倍率，
    transform 拉伸时直接拿旧纹理放大 → 糊。缩放现在走 width/height（见 imgStyle），
    不需要提前提示合成。
  */
}

@keyframes img-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.preview-loading,
.preview-fallback {
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.preview-fallback svg { width: 48px; height: 48px; opacity: 0.5; }

.nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  transition: background 0.12s;
}

.nav:hover { background: rgba(255, 255, 255, 0.22); }
.nav svg { width: 20px; height: 20px; }
.nav-prev { left: 8px; }
.nav-next { right: 8px; }

.preview-bottom {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  color: rgba(255, 255, 255, 0.65);
  font-size: 12px;
}

.meta { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hint { flex: none; opacity: 0.6; }
</style>
