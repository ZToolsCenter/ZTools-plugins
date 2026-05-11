<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  timestamp: string
  paused: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-pause'): void
  (e: 'reset'): void
  (e: 'copy', text: string): void
}>()

const copiedRecently = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null

function handleCopy(ts: string) {
  emit('copy', ts)
  copiedRecently.value = true
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => { copiedRecently.value = false }, 1500)
}
</script>

<template>
  <div class="section">
    <div class="section-label">当前时间戳:</div>
    <div class="current-ts-section">
      <span
        class="current-ts-value"
        :title="copiedRecently ? '已复制' : '点击复制'"
        @click="handleCopy(timestamp)"
      >
        {{ timestamp }}
      </span>

      <button
        class="pause-btn"
        :class="paused ? 'paused' : 'running'"
        @click="$emit('toggle-pause')"
      >
        <!-- 暂停图标 -->
        <svg v-if="!paused" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="4" width="4" height="16" rx="1"/>
          <rect x="14" y="4" width="4" height="16" rx="1"/>
        </svg>
        <!-- 播放图标 -->
        <svg v-else viewBox="0 0 24 24" fill="currentColor">
          <polygon points="6,4 20,12 6,20"/>
        </svg>
        {{ paused ? '继续' : '暂停' }}
      </button>

      <button class="reset-btn" @click="$emit('reset')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="1 4 1 10 7 10"/>
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
        </svg>
        重置数据
      </button>
    </div>
  </div>
</template>
