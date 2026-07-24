<script setup lang="ts">
import { ref, computed } from 'vue'
import type { TimestampUnit, TimezoneOption } from '@/types'
import { msToUnit, formatTimestamp } from '@/utils/timezone'
import DatePickerPopup from './DatePickerPopup.vue'

const props = defineProps<{
  modelValue: number | null
  unit: TimestampUnit
  timezone: TimezoneOption
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: number | null): void
  (e: 'copy', text: string): void
}>()

const showPicker = ref(false)
const inputRef = ref<HTMLElement | null>(null)

const displayDate = computed(() => {
  if (props.modelValue === null) return ''
  return formatTimestamp(props.modelValue, props.timezone)
})

const resultTimestamp = computed(() => {
  if (props.modelValue === null) return null
  return msToUnit(props.modelValue, props.unit)
})

function openPicker() {
  showPicker.value = true
}

function onPickerUpdate(val: number | null) {
  emit('update:modelValue', val)
}

function onCopy() {
  if (resultTimestamp.value) {
    emit('copy', resultTimestamp.value)
  }
}

const copiedRecently = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null

function handleCopy() {
  onCopy()
  copiedRecently.value = true
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => { copiedRecently.value = false }, 1500)
}
</script>

<template>
  <div class="section">
    <div class="section-label">
      日期 <span class="arrow">→</span>
      (<span class="tz-name">{{ timezone.label.split('|')[1]?.trim() || '本地' }}</span>)
      时间戳:
    </div>
    <div class="row">
      <div ref="inputRef" class="input-with-icon" @click="openPicker">
        <input
          class="input-field"
          :value="displayDate"
          placeholder="请选择日期"
          readonly
        />
        <span class="input-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
        </span>
      </div>
      <span class="result-separator">-</span>
      <div class="result-value">
        <span v-if="resultTimestamp" class="result-text">{{ resultTimestamp }}</span>
        <button
          v-if="resultTimestamp"
          class="copy-btn"
          :class="{ copied: copiedRecently }"
          title="复制时间戳"
          @click.stop="handleCopy"
        >
          <svg v-if="!copiedRecently" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </button>
      </div>
    </div>

    <Teleport to="body">
      <DatePickerPopup
        v-if="showPicker"
        :model-value="modelValue"
        :timezone="timezone"
        :anchor-el="inputRef"
        @update:model-value="onPickerUpdate"
        @close="showPicker = false"
      />
    </Teleport>
  </div>
</template>
