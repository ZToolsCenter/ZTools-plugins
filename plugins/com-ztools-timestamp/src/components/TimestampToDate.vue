<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { TimestampUnit, TimezoneOption } from '@/types'
import { unitToMs, formatTimestampMulti, detectUnit, formatRelativeTime } from '@/utils/timezone'

const props = defineProps<{
  modelValue: string
  unit: TimestampUnit
  timezone: TimezoneOption
  nowMs: number
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'copy', text: string): void
  (e: 'detect-unit', unit: TimestampUnit): void
}>()

const inputVal = ref(props.modelValue)

watch(() => props.modelValue, (v) => { inputVal.value = v })

const resultMs = computed(() => {
  if (!inputVal.value.trim()) return null
  return unitToMs(inputVal.value, props.unit)
})

const resultFormats = computed(() => {
  if (resultMs.value === null) return null
  if (isNaN(resultMs.value)) return null
  const msMin = -30610224000000
  const msMax = 253402300800000
  if (resultMs.value < msMin || resultMs.value > msMax) return null
  return formatTimestampMulti(resultMs.value, props.timezone)
})

// 相对时间
const relativeTime = computed(() => {
  if (resultMs.value === null || isNaN(resultMs.value)) return null
  const msMin = -30610224000000
  const msMax = 253402300800000
  if (resultMs.value < msMin || resultMs.value > msMax) return null
  return formatRelativeTime(resultMs.value, props.nowMs)
})

const isInvalid = computed(() => {
  const trimmed = inputVal.value.trim()
  if (!trimmed) return false
  if (!/^-?\d+$/.test(trimmed)) return true
  return resultFormats.value === null
})

// 自动识别提示
const detectedUnit = ref<TimestampUnit | null>(null)
const showDetectHint = ref(false)
let hintTimer: ReturnType<typeof setTimeout> | null = null

function onInput(e: Event) {
  const val = (e.target as HTMLInputElement).value
  inputVal.value = val
  emit('update:modelValue', val)

  // 自动识别单位
  const detected = detectUnit(val)
  if (detected && detected !== props.unit) {
    detectedUnit.value = detected
    showDetectHint.value = true
    if (hintTimer) clearTimeout(hintTimer)
    // 自动切换
    emit('detect-unit', detected)
    hintTimer = setTimeout(() => { showDetectHint.value = false }, 2000)
  } else {
    detectedUnit.value = null
    showDetectHint.value = false
  }
}

// 复制状态
const copiedIndex = ref<number | null>(null)
let copyTimer: ReturnType<typeof setTimeout> | null = null

function handleCopy(text: string, idx: number) {
  emit('copy', text)
  copiedIndex.value = idx
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => { copiedIndex.value = null }, 1500)
}

const unitLabels: Record<string, string> = {
  second: '秒',
  millisecond: '毫秒',
  nanosecond: '纳秒'
}
</script>

<template>
  <div class="section">
    <div class="section-label">
      时间戳 <span class="arrow">→</span>
      (<span class="tz-name">{{ timezone.label.split('|')[1]?.trim() || '本地' }}</span>)
      日期
    </div>
    <div class="row">
      <div class="input-wrapper">
        <input
          class="input-field"
          :class="{ 'input-error': isInvalid }"
          :value="inputVal"
          placeholder="请输入时间戳"
          @input="onInput"
          @keydown.enter="($event.target as HTMLInputElement).blur()"
        />
        <transition name="hint-fade">
          <span v-if="showDetectHint && detectedUnit" class="detect-hint">
            已识别为{{ unitLabels[detectedUnit] }}
          </span>
        </transition>
      </div>
      <span class="result-separator">-</span>
      <div class="result-value" v-if="!resultFormats">
        <span v-if="isInvalid" class="result-placeholder" style="color: var(--danger);">无效时间戳</span>
      </div>
      <div v-else class="multi-result">
        <div
          v-for="(fmt, idx) in resultFormats"
          :key="idx"
          class="multi-result-item"
          @click="handleCopy(fmt, idx)"
          :title="'点击复制: ' + fmt"
        >
          <span class="result-text">{{ fmt }}</span>
          <button
            class="copy-btn"
            :class="{ copied: copiedIndex === idx }"
            style="opacity: 1; width: 20px; height: 20px;"
            @click.stop="handleCopy(fmt, idx)"
          >
            <svg v-if="copiedIndex !== idx" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </button>
        </div>
        <!-- 相对时间 -->
        <div v-if="relativeTime" class="relative-time">
          {{ relativeTime }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.input-error {
  border-color: var(--danger) !important;
}
.input-error:focus {
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.15) !important;
}

.input-wrapper {
  flex: 1;
  min-width: 0;
  position: relative;
}

.input-wrapper .input-field {
  width: 100%;
}

.detect-hint {
  position: absolute;
  bottom: -18px;
  left: 0;
  font-size: 11px;
  color: var(--text-accent);
  white-space: nowrap;
}

.hint-fade-enter-active,
.hint-fade-leave-active {
  transition: opacity 0.3s ease;
}
.hint-fade-enter-from,
.hint-fade-leave-to {
  opacity: 0;
}

.relative-time {
  font-size: 12px;
  color: var(--text-accent);
  padding: 2px 6px;
  font-style: italic;
}
</style>
