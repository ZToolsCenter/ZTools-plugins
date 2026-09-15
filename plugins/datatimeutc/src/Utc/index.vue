<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, computed } from 'vue'
import { DEFAULT_FORMAT, getTimezoneOptions, getTimezoneLabel, type FormatOptions, type TimezoneOption } from './format'
import { getNow, isSynced, getOffset, startPeriodicSync, stopPeriodicSync, onSyncTick } from './time'

const STORAGE_KEY = 'utc-config'

interface StoredConfig {
  timezone: string
  format: FormatOptions
}

const now = ref(new Date())
const timezone = ref<string>('UTC')
const format = ref<FormatOptions>({ ...DEFAULT_FORMAT })
const timezoneOptions = ref<TimezoneOption[]>([])
const floatWinId = ref<number | null>(null)
const synced = ref(false)
const offsetMs = ref(0)
const showSettings = ref(false)

let timer: number | undefined
let unbindSyncTick: (() => void) | undefined

// 中央大字时间：时分秒 + 毫秒（与图片样式一致，固定显示时分秒.毫秒）
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

// 当前时区显示名（"UTC+8 中国标准时间"），随时间刷新（夏令时切换时偏移可能变化）
const timezoneLabel = computed(() => getTimezoneLabel(timezone.value, now.value))
// 时区搜索关键字（原生 select 无内置搜索，用输入框过滤下拉项）
const tzKeyword = ref('')
// 过滤后的时区选项（匹配 IANA 名或中文显示名，不区分大小写）
const filteredTzOptions = computed(() => {
  const kw = tzKeyword.value.trim().toLowerCase()
  if (!kw) return timezoneOptions.value
  return timezoneOptions.value.filter(
    o => o.value.toLowerCase().includes(kw) || o.label.toLowerCase().includes(kw)
  )
})
// 校时状态文案：
//   当前会话已校时 → "✓ 已校准 (NTP, -7ms)"
//   仅 dbStorage 有上次 offset → "✓ 已校准 (上次, -7ms)"
//   无任何 offset → "本地系统时间"
const syncLabel = computed(() => {
  const ms = offsetMs.value
  if (ms === 0 && !synced.value) return '本地系统时间'
  const sign = ms > 0 ? '+' : ms < 0 ? '-' : ''
  const src = synced.value ? 'NTP' : '上次'
  return `已校准 (${src}, ${sign}${Math.abs(ms)}ms)`
})

async function loadConfig() {
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

function saveConfig() {
  try {
    window.ztools.dbStorage.setItem(STORAGE_KEY, {
      timezone: timezone.value,
      format: { ...format.value }
    })
  } catch (_e) {
    // 忽略写入失败
  }
}

watch([timezone, format], saveConfig, { deep: true })

function openFloat() {
  const id = window.services.openFloatWindow()
  if (id === null) {
    // services 已通过 notification 提示具体原因，此处不再重复
    return
  }
  floatWinId.value = id
  window.ztools.outPlugin()
}

onMounted(() => {
  // 生成 "UTC±X 中文名" 选项列表
  timezoneOptions.value = getTimezoneOptions()
  loadConfig()
  // 先用模块加载时恢复的 offset 立即显示（可能为 0）
  offsetMs.value = getOffset()
  // 每秒刷新 getNow() 中的本地时钟够用，但显示毫秒需 250ms 刷新
  timer = window.setInterval(() => {
    now.value = new Date(getNow())
  }, 250)
  // 周期 NTP 校准：启动立即校准一次，此后每 5 分钟一次；每次完成回调刷新 UI
  unbindSyncTick = onSyncTick(() => {
    synced.value = isSynced()
    offsetMs.value = getOffset()
  })
  startPeriodicSync(5 * 60 * 1000)
})

onBeforeUnmount(() => {
  if (timer !== undefined) window.clearInterval(timer)
  stopPeriodicSync()
  if (unbindSyncTick) unbindSyncTick()
})
</script>

<template>
  <div class="utc-card">
    <!-- 主展示区：三行垂直居中（日期 / 时间 / 校准） -->
    <div class="utc-hero">
      <!-- 第一行：日期 + 星期 -->
      <div class="utc-date">{{ bigDate }}</div>

      <!-- 第二行：大字时间（毫秒小号）+ 时区名 -->
      <div class="utc-time-block">
        <div class="utc-time">
          <span class="utc-time-main">{{ bigTime.time }}</span><span class="utc-time-ms">.{{ bigTime.ms }}</span>
        </div>
        <div class="utc-zone">{{ timezoneLabel }}</div>
      </div>

      <!-- 第三行：校时徽章 -->
      <div class="utc-sync-row">
        <span class="utc-sync-badge" :class="{ 'is-synced': offsetMs !== 0 || synced }" :title="offsetMs !== 0 ? `本地时间与服务器相差 ${offsetMs > 0 ? '+' : ''}${offsetMs}ms（${offsetMs > 0 ? '本地慢' : '本地快'}），每 5 分钟自动校准` : '使用本地系统时间，等待首次 NTP 校准'">
          <span class="utc-sync-tick">✓</span>{{ syncLabel }}
        </span>
      </div>
    </div>

    <!-- 底部操作（含折叠设置区），固定在底部 -->
    <div class="utc-footer">
      <div class="utc-actions">
        <button class="utc-btn utc-btn-primary" @click="openFloat">
          <span class="utc-btn-icon" aria-hidden="true">⌖</span>
          <span>开启悬浮窗</span>
        </button>
        <button class="utc-btn utc-btn-ghost" :class="{ 'is-active': showSettings }" :title="showSettings ? '收起设置' : '展开时区/格式设置'" @click="showSettings = !showSettings">
          <svg class="utc-setting-icon" viewBox="0 0 1024 1024" width="14" height="14" aria-hidden="true">
            <path fill="currentColor" d="M512 384a128 128 0 1 0 0 256 128 128 0 0 0 0-256zm0 192a64 64 0 1 1 0-128 64 64 0 0 1 0 128z"/>
            <path fill="currentColor" d="M888 531.2l-46-26.6a330 330 0 0 0 0-37.2l46-26.6c20.8-12 28-38.6 16.4-59.6l-58.4-101.2a43.4 43.4 0 0 0-59.2-16l-46.4 26.8a328 328 0 0 0-32.2-18.6V224.8c0-24-19.6-43.6-43.6-43.6H496.4c-24 0-43.6 19.6-43.6 43.6v53.4c-11.2 5.4-22 11.6-32.2 18.6l-46.4-26.8a43.4 43.4 0 0 0-59.2 16L256.6 387.2c-11.6 21-4.4 47.6 16.4 59.6l46 26.6c-0.8 6.2-1.2 12.4-1.2 18.6s0.4 12.4 1.2 18.6l-46 26.6c-20.8 12-28 38.6-16.4 59.6l58.4 101.2a43.4 43.4 0 0 0 59.2 16l46.4-26.8c10.2 7 21 13.2 32.2 18.6v53.4c0 24 19.6 43.6 43.6 43.6h112.8c24 0 43.6-19.6 43.6-43.6v-53.4c11.2-5.4 22-11.6 32.2-18.6l46.4 26.8a43.4 43.4 0 0 0 59.2-16l58.4-101.2c11.6-21 4.4-47.6-16.4-59.6zM512 704a192 192 0 1 1 0-384 192 192 0 0 1 0 384z"/>
          </svg>
        </button>
      </div>

      <!-- 折叠区：时区 + 格式（默认收起） -->
      <transition name="utc-collapse">
        <div v-if="showSettings" class="utc-settings">
          <div class="utc-row">
            <span class="utc-label">时区</span>
            <div class="utc-tz-picker">
              <input
                v-model="tzKeyword"
                class="utc-tz-search"
                type="text"
                placeholder="搜索时区，如 shanghai / UTC+8"
                autocomplete="off"
                spellcheck="false"
              />
              <select v-model="timezone" class="utc-select" size="1">
                <option v-if="!filteredTzOptions.some(o => o.value === timezone)" :value="timezone">{{ timezoneLabel }}</option>
                <option v-for="o in filteredTzOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
            </div>
          </div>
          <div class="utc-format">
            <label class="utc-check"><input v-model="format.showDate" type="checkbox"><span>年月日</span></label>
            <label class="utc-check"><input v-model="format.showWeekday" type="checkbox"><span>星期</span></label>
            <label class="utc-check"><input v-model="format.showTime" type="checkbox"><span>时分秒</span></label>
            <label class="utc-check"><input v-model="format.showMs" type="checkbox"><span>毫秒</span></label>
            <label class="utc-check"><input v-model="format.hour12" type="checkbox"><span>12 小时制</span></label>
          </div>
        </div>
      </transition>
    </div>
  </div>
</template>

<style scoped>
.utc-card {
  --card-bg: #202021;
  --card-fg: #bcbcbc;
  --card-fg-dim: #6f7070;
  --card-accent: #52c47c;
  --card-border: rgba(255, 255, 255, 0.06);
  box-sizing: border-box;
  padding: 16px 24px;
  width: 100%;
  height: 100%;
  background: var(--card-bg);
  color: var(--card-fg);
  display: flex;
  flex-direction: column;
  /* 主展示区 + 底部操作作为整体垂直居中 */
  justify-content: center;
  overflow: hidden;
}

@media (prefers-color-scheme: light) {
  .utc-card {
    --card-bg: #f7f7f7;
    --card-fg: #2c2c2c;
    --card-fg-dim: #888;
    --card-border: rgba(0, 0, 0, 0.06);
  }
}

/* 主展示区：与底部操作整体居中，不再单独占满剩余空间 */
.utc-hero {
  flex: 0 0 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: clamp(6px, 2.4vh, 16px);
}

/* 顶部日期：随视口高度自适应 */
.utc-date {
  font-size: clamp(13px, 1.6vh + 8px, 17px);
  color: var(--card-fg-dim);
  letter-spacing: 0.5px;
}

/* 第二行：时间块（大字 + 时区名） */
.utc-time-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(2px, 0.8vh, 6px);
}

/* 时区名 */
.utc-zone {
  font-size: clamp(12px, 1.3vh + 8px, 15px);
  color: var(--card-fg-dim);
  letter-spacing: 0.5px;
}

/* 中央大字时间：随视口宽高自适应 */
.utc-time {
  font-size: clamp(36px, min(9vw, 8.5vh), 76px);
  font-weight: 700;
  color: var(--card-fg);
  font-variant-numeric: tabular-nums;
  letter-spacing: 1px;
  line-height: 1.15;
  text-align: center;
  white-space: nowrap;
}

.utc-time-ms {
  font-size: 0.5em;
  font-weight: 600;
  color: var(--card-fg-dim);
  margin-left: 2px;
  vertical-align: baseline;
}

/* 校时徽章 */
.utc-sync-row {
  display: flex;
}

.utc-sync-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: clamp(11px, 1.2vh + 7px, 13px);
  padding: 3px 10px;
  border-radius: 12px;
  color: var(--card-fg-dim);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--card-border);
}

.utc-sync-badge.is-synced {
  color: var(--card-accent);
  background: rgba(82, 196, 124, 0.10);
  border-color: rgba(82, 196, 124, 0.30);
}

.utc-sync-tick {
  font-weight: 700;
}

/* 底部固定区 */
.utc-footer {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}

.utc-actions {
  display: flex;
  gap: 8px;
  width: 100%;
  justify-content: center;
}

.utc-btn {
  flex: 1;
  max-width: 240px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--card-border);
  background: rgba(255, 255, 255, 0.04);
  color: var(--card-fg);
  padding: 8px 12px;
  border-radius: 8px;
  font-size: clamp(13px, 1.2vh + 9px, 14px);
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
}

.utc-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.12);
}

.utc-btn:active {
  opacity: 0.7;
}

.utc-btn-primary {
  background: #409eff;
  color: #fff;
  border-color: transparent;
}

.utc-btn-primary:hover {
  background: #66b1ff;
}

.utc-btn-icon {
  font-size: 14px;
  line-height: 1;
}

.utc-btn-ghost {
  flex: 0 0 38px;
  max-width: 38px;
  padding: 8px 0;
}

.utc-btn-ghost.is-active {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.20);
}

/* 设置齿轮图标 */
.utc-setting-icon {
  display: block;
}

/* 折叠设置区：内容与上方三行水平居中对齐 */
.utc-settings {
  width: 100%;
  padding-top: 10px;
  border-top: 1px solid var(--card-border);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.utc-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.utc-label {
  font-size: 12px;
  color: var(--card-fg-dim);
  min-width: 36px;
}

/* 时区选择器：搜索框 + 原生下拉 */
.utc-tz-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 0 1 240px;
  min-width: 180px;
}

.utc-tz-search,
.utc-select {
  box-sizing: border-box;
  width: 100%;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--card-border);
  background: rgba(255, 255, 255, 0.04);
  color: var(--card-fg);
  font-size: 12px;
  line-height: 1.4;
  outline: none;
  transition: border-color 0.15s, background 0.15s;
}

.utc-tz-search:focus,
.utc-select:focus {
  border-color: #409eff;
  background: rgba(255, 255, 255, 0.07);
}

/* 原生 select 下拉面板颜色（Electron/Chromium 支持 color-scheme 深色面板） */
.utc-select {
  color-scheme: dark;
  cursor: pointer;
}

@media (prefers-color-scheme: light) {
  .utc-select {
    color-scheme: light;
    background: #fff;
  }

  .utc-tz-search {
    background: #fff;
  }
}

/* 格式选项：原生 checkbox */
.utc-format {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px 14px;
  font-size: 12px;
}

.utc-check {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  color: var(--card-fg);
  -webkit-user-select: none;
  user-select: none;
}

.utc-check input[type='checkbox'] {
  /* accent-color：原生复选框主题色（Chromium 支持） */
  accent-color: #409eff;
  width: 13px;
  height: 13px;
  margin: 0;
  cursor: pointer;
}

/* 折叠动画 */
.utc-collapse-enter-active,
.utc-collapse-leave-active {
  transition: opacity 0.18s ease, max-height 0.22s ease;
  overflow: hidden;
  max-height: 220px;
}

.utc-collapse-enter-from,
.utc-collapse-leave-to {
  opacity: 0;
  max-height: 0;
}
</style>
