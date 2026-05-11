<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { TIMEZONE_OPTIONS, UNIT_LABELS } from '@/types'
import type { TimestampUnit } from '@/types'
import { useTimestamp } from '@/composables/useTimestamp'
import { useTheme } from '@/composables/useTheme'
import { detectUnit } from '@/utils/timezone'
import DateToTimestamp from '@/components/DateToTimestamp.vue'
import TimestampToDate from '@/components/TimestampToDate.vue'
import CurrentTimestamp from '@/components/CurrentTimestamp.vue'

const {
  unit, timezoneIndex, timezone,
  currentTimestamp, paused, nowMs,
  selectedDateMs,
  inputTimestamp,
  togglePause, resetAll, copyToClipboard
} = useTimestamp()

const { theme, initTheme, toggleTheme } = useTheme()

onMounted(() => {
  initTheme()
  // 设置插件视图高度，确保在 ZTools 主窗口中完整显示
  window.ztools?.setExpendHeight?.(600)
})

// Toast 通知
const toastVisible = ref(false)
const toastMessage = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(msg: string) {
  toastMessage.value = msg
  toastVisible.value = true
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastVisible.value = false }, 1800)
}

function handleCopy(text: string) {
  copyToClipboard(text)
  showToast('已复制到剪贴板')
}

// 信息提示
const showInfo = ref(false)
const infoRef = ref<HTMLElement | null>(null)

function toggleInfo() {
  showInfo.value = !showInfo.value
}

function onDocClick(e: MouseEvent) {
  if (showInfo.value && infoRef.value && !infoRef.value.contains(e.target as Node)) {
    showInfo.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  window.addEventListener('ztools-enter', onZToolsEnter as EventListener)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  window.removeEventListener('ztools-enter', onZToolsEnter as EventListener)
})

// ZTools 搜索框传入的内容自动填充到时间戳输入
function onZToolsEnter(e: CustomEvent<string>) {
  const payload = e.detail?.trim()
  if (!payload) return
  if (/^-?\d+$/.test(payload)) {
    inputTimestamp.value = payload
    const detected = detectUnit(payload)
    if (detected) {
      unit.value = detected
      nextTick(updateIndicator)
    }
  }
}

const units: TimestampUnit[] = ['nanosecond', 'millisecond', 'second']

// 滑动指示器
const unitGroupRef = ref<HTMLElement | null>(null)
const indicatorStyle = ref<Record<string, string>>({})

function updateIndicator() {
  if (!unitGroupRef.value) return
  const activeBtn = unitGroupRef.value.querySelector('.unit-btn.active') as HTMLElement
  if (!activeBtn) return
  const groupRect = unitGroupRef.value.getBoundingClientRect()
  const btnRect = activeBtn.getBoundingClientRect()
  indicatorStyle.value = {
    left: `${btnRect.left - groupRect.left}px`,
    width: `${btnRect.width}px`
  }
}

watch(unit, () => nextTick(updateIndicator))
onMounted(() => nextTick(updateIndicator))
</script>

<template>
  <div class="app-container">
    <!-- 头部栏 -->
    <div class="header-bar">
      <!-- 单位切换 -->
      <div ref="unitGroupRef" class="unit-group">
        <div class="unit-group-indicator" :style="indicatorStyle"></div>
        <button
          v-for="u in units"
          :key="u"
          class="unit-btn"
          :class="{ active: unit === u }"
          @click="unit = u"
        >
          {{ UNIT_LABELS[u] }}
        </button>
      </div>

      <!-- 时区选择 -->
      <div class="tz-select-wrapper">
        <select
          class="tz-select"
          :value="timezoneIndex"
          @change="timezoneIndex = Number(($event.target as HTMLSelectElement).value)"
        >
          <option
            v-for="(tz, idx) in TIMEZONE_OPTIONS"
            :key="idx"
            :value="idx"
          >
            {{ tz.label }}
          </option>
        </select>
        <span class="tz-select-arrow">▾</span>
      </div>

      <!-- 工具按钮 -->
      <div class="header-actions">
        <!-- 信息按钮 -->
        <div ref="infoRef" style="position: relative;">
          <button class="icon-btn" @click.stop="toggleInfo" title="关于插件">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
          </button>
          <div v-if="showInfo" class="info-tooltip">
            Unix 时间戳是从 1970-01-01 00:00:00 UTC 起<br/>
            经过的时间量，支持秒/毫秒/纳秒单位。<br/>
            点击转换结果可一键复制到剪贴板。
          </div>
        </div>

        <!-- 主题切换 -->
        <button class="theme-toggle" @click="toggleTheme" :title="theme === 'light' ? '切换到暗色' : '切换到亮色'">
          <div class="toggle-track">
            <div class="toggle-thumb" :class="theme">
              <!-- 太阳 -->
              <svg v-if="theme === 'light'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <circle cx="12" cy="12" r="4"/>
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
              </svg>
              <!-- 月亮 -->
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            </div>
          </div>
        </button>
      </div>
    </div>

    <!-- 日期 → 时间戳 -->
    <DateToTimestamp
      :model-value="selectedDateMs"
      :unit="unit"
      :timezone="timezone"
      @update:model-value="selectedDateMs = $event"
      @copy="handleCopy"
    />

    <!-- 时间戳 → 日期 -->
    <TimestampToDate
      :model-value="inputTimestamp"
      :unit="unit"
      :timezone="timezone"
      :now-ms="nowMs"
      @update:model-value="inputTimestamp = $event"
      @copy="handleCopy"
      @detect-unit="unit = $event; nextTick(updateIndicator)"
    />

    <!-- 当前时间戳 -->
    <CurrentTimestamp
      :timestamp="currentTimestamp"
      :paused="paused"
      @toggle-pause="togglePause"
      @reset="resetAll"
      @copy="handleCopy"
    />

    <!-- Toast 提示 -->
    <Teleport to="body">
      <div v-if="toastVisible" class="toast-container">
        <div class="toast">{{ toastMessage }}</div>
      </div>
    </Teleport>
  </div>
</template>
