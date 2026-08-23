<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, computed } from 'vue'
import { Setting } from '@element-plus/icons-vue'
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
// el-select-v2 需要 {label, value} 结构（时区按偏移去重后约 40 项）
const tzSelectOptions = computed(() => timezoneOptions.value.map(o => ({ label: o.label, value: o.value })))
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
          <el-icon><Setting /></el-icon>
        </button>
      </div>

      <!-- 折叠区：时区 + 格式（默认收起） -->
      <transition name="utc-collapse">
        <div v-if="showSettings" class="utc-settings">
          <div class="utc-row">
            <span class="utc-label">时区</span>
            <el-select-v2
              v-model="timezone"
              :options="tzSelectOptions"
              filterable
              placeholder="搜索或选择时区"
              class="utc-select"
            />
          </div>
          <div class="utc-format">
            <el-checkbox v-model="format.showDate">年月日</el-checkbox>
            <el-checkbox v-model="format.showWeekday">星期</el-checkbox>
            <el-checkbox v-model="format.showTime">时分秒</el-checkbox>
            <el-checkbox v-model="format.showMs">毫秒</el-checkbox>
            <el-checkbox v-model="format.hour12">12 小时制</el-checkbox>
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
  background: var(--el-color-primary, var(--blue, #409eff));
  color: #fff;
  border-color: transparent;
}

.utc-btn-primary:hover {
  background: var(--el-color-primary-light-3, #66b1ff);
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

.utc-select {
  /* 限宽使时区行整体居中（与主按钮 240px 对齐） */
  flex: 0 1 240px;
  min-width: 180px;
}

.utc-format {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px 14px;
  font-size: 12px;
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
