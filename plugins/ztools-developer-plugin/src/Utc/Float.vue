<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed, watch } from 'vue'
import { DEFAULT_FORMAT, formatTime, type FormatOptions } from './format'
import { getNow, getOffset } from './time'

const STORAGE_KEY = 'utc-config'

// ===== 悬浮窗偏好：透明度 / 窗口缩放 =====
// 尺寸偏好由主插件窗口在创建悬浮窗时读取（悬浮窗自身无窗口句柄，仅存偏好）
const FLOAT_PREFS_KEY = 'utc-float-prefs'
const BASE_W = 420
const BASE_H = 165
const MIN_OPACITY = 0.3
const MIN_SCALE = 0.7
const MAX_SCALE = 1.6

interface FloatPrefs {
  /** 背景透明度（0.3–1，只作用于背景/边框，文字保持清晰） */
  opacity: number
  /** 窗口缩放（0.7–1.6，基准 420×165） */
  scale: number
}

const DEFAULT_PREFS: FloatPrefs = { opacity: 1, scale: 1 }

const opacity = ref(DEFAULT_PREFS.opacity)
const scale = ref(DEFAULT_PREFS.scale)

let resizeTimer: number | undefined

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function loadPrefs() {
  try {
    const stored = window.ztools.dbStorage.getItem(FLOAT_PREFS_KEY) as FloatPrefs | null
    if (stored) {
      if (typeof stored.opacity === 'number' && isFinite(stored.opacity)) {
        opacity.value = clamp(stored.opacity, MIN_OPACITY, 1)
      }
      if (typeof stored.scale === 'number' && isFinite(stored.scale)) {
        scale.value = clamp(stored.scale, MIN_SCALE, MAX_SCALE)
      }
    }
  } catch (_e) {
    // 读取失败保持默认
  }
}

function savePrefs() {
  try {
    window.ztools.dbStorage.setItem(FLOAT_PREFS_KEY, {
      opacity: opacity.value,
      scale: scale.value
    })
  } catch (_e) {
    // 忽略写入失败
  }
}

// 大小变化：节流后通知主插件窗口实时 setBounds
// （主窗口 preload 监听 ztools-float-resize 频道，代为调整悬浮窗尺寸）
function scheduleResize() {
  if (resizeTimer !== undefined) window.clearTimeout(resizeTimer)
  resizeTimer = window.setTimeout(() => {
    try {
      window.ztools.sendToParent('ztools-float-resize', {
        width: Math.round(BASE_W * scale.value),
        height: Math.round(BASE_H * scale.value)
      })
    } catch (_e) {
      // 主插件窗口不在线时忽略；偏好已保存，下次打开悬浮窗按新尺寸创建
    }
  }, 120)
}

// 控制行（透明度/大小滑块）与校时徽章切换显示
const showSettings = ref(false)

watch(opacity, savePrefs)
watch(scale, () => {
  savePrefs()
  scheduleResize()
})

interface StoredConfig {
  timezone: string
  format: FormatOptions
}

const now = ref(new Date())
const timezone = ref<string>('UTC')
const format = ref<FormatOptions>({ ...DEFAULT_FORMAT })
const offsetMs = ref(0)

let timer: number | undefined

// 中央大字时间：时分秒 + 毫秒（与参考图一致）
const bigTime = computed(() => {
  const d = now.value
  const timeOpts: Intl.DateTimeFormatOptions = {
    timeZone: timezone.value,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: format.value.hour12
  }
  let timeStr: string
  try {
    timeStr = new Intl.DateTimeFormat('zh-CN', timeOpts).format(d)
  } catch (_e) {
    timeStr = new Intl.DateTimeFormat('zh-CN', { ...timeOpts, timeZone: undefined }).format(d)
  }
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return { time: timeStr, ms }
})

// 顶部日期 + 星期
const bigDate = computed(() => {
  const d = now.value
  const dateOpts: Intl.DateTimeFormatOptions = {
    timeZone: timezone.value,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long'
  }
  try {
    return new Intl.DateTimeFormat('zh-CN', dateOpts).format(d)
  } catch (_e) {
    return new Intl.DateTimeFormat('zh-CN', { ...dateOpts, timeZone: undefined }).format(d)
  }
})

// 校时徽章文案（与主窗口一致）
const syncLabel = computed(() => {
  const ms = offsetMs.value
  if (ms === 0) return '本地系统时间'
  const sign = ms > 0 ? '+' : ms < 0 ? '-' : ''
  return `已校准 (NTP, ${sign}${Math.abs(ms)}ms)`
})

function loadConfig() {
  try {
    const stored = window.ztools.dbStorage.getItem(STORAGE_KEY) as StoredConfig | null
    if (stored) {
      if (typeof stored.timezone === 'string') timezone.value = stored.timezone
      if (stored.format && typeof stored.format === 'object') {
        format.value = { ...DEFAULT_FORMAT, ...stored.format }
      }
    }
  } catch (_e) {
    // 读取失败保持默认
  }
}

function close() {
  // 通知主插件窗口彻底退出（杀进程），避免主插件窗口残留导致下次打开 ztools 仍显示
  try { window.ztools && window.ztools.sendToParent && window.ztools.sendToParent('ztools-float-closed') } catch (_e) {}
  // 双保险：悬浮窗自身也尝试 outPlugin(true) 杀整个插件进程
  try { window.ztools && window.ztools.outPlugin && window.ztools.outPlugin(true) } catch (_e) {}
  // 最终兜底：关闭自身窗口
  try { window.close() } catch (_e) {}
}

onMounted(() => {
  document.body.classList.add('float-mode')
  loadConfig()
  loadPrefs()
  // 悬浮窗无 services.syncNtpTime，但 time.ts 模块加载时已从 dbStorage 恢复上次 offset
  offsetMs.value = getOffset()
  timer = window.setInterval(() => {
    now.value = new Date(getNow())
  }, 250)
})

onBeforeUnmount(() => {
  if (timer !== undefined) window.clearInterval(timer)
  if (resizeTimer !== undefined) window.clearTimeout(resizeTimer)
  document.body.classList.remove('float-mode')
})
</script>

<template>
  <div
    class="float-card"
    :title="timezone"
    :style="{ '--float-alpha': opacity, '--float-scale': scale }"
  >
    <!-- 整卡可拖拽；按钮/滑块区域 no-drag -->
    <button class="float-close" title="关闭" @click="close">×</button>
    <button
      class="float-close float-settings-btn"
      :class="{ 'is-active': showSettings }"
      :title="showSettings ? '收起设置' : '透明度 / 大小设置'"
      @click="showSettings = !showSettings"
    >⚙</button>

    <div class="float-date">{{ bigDate }}</div>
    <div class="float-time">
      <span class="float-time-main">{{ bigTime.time }}</span><span class="float-time-ms">.{{ bigTime.ms }}</span>
    </div>
    <!-- 控制行与校时徽章占同一行，避免窗口内容溢出 -->
    <div v-if="showSettings" class="float-ctrl">
      <span class="float-ctrl-label">透</span>
      <input
        v-model.number="opacity"
        class="float-ctrl-range"
        type="range"
        min="0.3"
        max="1"
        step="0.05"
        title="背景透明度"
      >
      <span class="float-ctrl-label">缩</span>
      <input
        v-model.number="scale"
        class="float-ctrl-range"
        type="range"
        min="0.7"
        max="1.6"
        step="0.05"
        title="大小"
      >
    </div>
    <div v-else class="float-badge-row">
      <span class="float-badge" :class="{ 'is-synced': offsetMs !== 0 }">
        <span class="float-badge-tick">✓</span>{{ syncLabel }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.float-card {
  --float-bg: #181818;
  --float-border: #303030;
  --float-date-fg: #868886;
  --float-time-fg: #d1d1d1;
  --float-accent: #53a153;
  /* 由 :style 注入：--float-alpha 背景透明度（0.3–1）、--float-scale 字号缩放（0.7–1.6） */
  --float-alpha: 1;
  --float-scale: 1;
  position: relative;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  /* 背景与边框随透明度混入 alpha（color-mix），文字保持不透明确保可读 */
  background: color-mix(in srgb, var(--float-bg) calc(var(--float-alpha) * 100%), transparent);
  border: 1px solid color-mix(in srgb, var(--float-border) calc(var(--float-alpha) * 100%), transparent);
  color: var(--float-time-fg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: calc(4px * var(--float-scale));
  padding: 10px 14px;
  /* 整卡拖拽 */
  -webkit-app-region: drag;
  cursor: move;
  user-select: none;
  overflow: hidden;
}

@media (prefers-color-scheme: light) {
  .float-card {
    --float-bg: #fafafa;
    --float-border: #d8d8d8;
    --float-date-fg: #888;
    --float-time-fg: #2c2c2c;
  }
}

/* 右上角按钮组（关闭 + 设置）：no-drag 保证可点击 */
.float-close {
  -webkit-app-region: no-drag;
  position: absolute;
  top: 4px;
  right: 5px;
  width: 18px;
  height: 18px;
  line-height: 16px;
  padding: 0;
  border: none;
  background: transparent;
  color: #666;
  font-size: 14px;
  cursor: pointer;
  border-radius: 4px;
  opacity: 0.6;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
}

.float-close:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.10);
  color: #fff;
}

/* 设置按钮：位于关闭按钮左侧 */
.float-settings-btn {
  right: 26px;
  font-size: 11px;
  line-height: 18px;
}

.float-settings-btn.is-active {
  opacity: 1;
  background: rgba(255, 255, 255, 0.10);
}

@media (prefers-color-scheme: light) {
  .float-close:hover {
    background: rgba(0, 0, 0, 0.08);
    color: #222;
  }
}

/* 日期行（字号随缩放） */
.float-date {
  font-size: calc(12px * var(--float-scale));
  color: var(--float-date-fg);
  letter-spacing: 0.5px;
}

/* 大字时间（字号随缩放） */
.float-time {
  font-size: calc(30px * var(--float-scale));
  font-weight: 700;
  color: var(--float-time-fg);
  font-variant-numeric: tabular-nums;
  letter-spacing: 1px;
  line-height: 1.2;
  white-space: nowrap;
}

.float-time-ms {
  font-size: 0.5em;
  font-weight: 600;
  color: var(--float-date-fg);
  margin-left: 1px;
}

/* 校时徽章（字号随缩放） */
.float-badge-row {
  display: flex;
}

.float-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: calc(11px * var(--float-scale));
  padding: 2px 9px;
  border-radius: 10px;
  color: var(--float-date-fg);
  background: rgba(255, 255, 255, 0.04);
}

.float-badge.is-synced {
  color: var(--float-accent);
  background: rgba(83, 161, 83, 0.10);
}

.float-badge-tick {
  font-weight: 700;
}

/* 透明度/大小控制行：与徽章同行切换，no-drag 保证滑块可拖动 */
.float-ctrl {
  -webkit-app-region: no-drag;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  max-width: 320px;
}

.float-ctrl-label {
  font-size: 11px;
  color: var(--float-date-fg);
  flex-shrink: 0;
}

.float-ctrl-range {
  flex: 1;
  min-width: 0;
  height: 14px;
  margin: 0;
  accent-color: var(--float-accent);
  cursor: pointer;
}
</style>
