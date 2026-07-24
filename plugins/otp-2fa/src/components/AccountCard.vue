<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  acc: any,
  index: number,
  token: string,
  nextToken: string,
  timeLeft: number,
  config: any,
  copiedId: string | null,
  isDragging: boolean,
  dragIndex: number | null,
  msNow: number
}>()

const emits = defineEmits(['dragstart', 'dragover', 'dragend', 'drop', 'contextmenu', 'copy', 'refresh-hotp'])

const lowTime = computed(() => (props.acc.type || 'totp') !== 'hotp' && props.timeLeft <= 5)

const getFormattedToken = (token: string) => {
  const t = token || '......'
  return t.slice(0, 3) + ' ' + t.slice(3)
}

const getFormattedNextToken = (token: string) => {
  if (!token || token === 'Error') return '------'
  return token.slice(0, 3) + ' ' + token.slice(3)
}
</script>

<template>
  <div class="card" :class="{
    pinned: acc.pinned,
    dragging: isDragging && dragIndex === index,
    'low-time': lowTime
  }" :draggable="!acc.pinned" 
    @dragstart="emits('dragstart', index, $event)"
    @dragover.prevent="emits('dragover', index, $event)" 
    @dragend="emits('dragend')"
    @drop="emits('drop')" 
    @contextmenu.prevent="emits('contextmenu', acc, $event)"
    @click="emits('copy', acc, $event)">

    <div v-if="acc.pinned" class="pin-indicator"></div>

    <div class="card-left">
      <div class="card-header">
        <div class="card-title">{{ acc.name }}</div>
      </div>
      <div class="code-display">
        <div class="code-text">
          {{ getFormattedToken(token) }}
          <span v-if="config.nextPreview" class="next-code">{{ getFormattedNextToken(nextToken) }}</span>
        </div>
      </div>
    </div>

    <div class="timer-container"
      v-if="(config.timerStyle === 'circle' && (acc.type || 'totp') !== 'hotp') || copiedId === acc.id || (acc.type || 'totp') === 'hotp'">
      <transition name="fade" mode="out-in">
        <div :key="copiedId === acc.id ? 'check' : ((acc.type || 'totp') === 'hotp' ? 'refresh' : 'timer')">
          <svg v-if="copiedId === acc.id" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#4caf50"
            stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="copy-icon">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <div v-else-if="(acc.type || 'totp') === 'hotp'" class="refresh-btn"
            :class="{ cooling: acc._lastRefresh && (msNow - acc._lastRefresh < 5000) }"
            @click.stop="emits('refresh-hotp', acc)">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
              stroke-linecap="round" stroke-linejoin="round">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
            </svg>
          </div>
          <svg v-else-if="(acc.type || 'totp') !== 'hotp'" width="40" height="40" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="18" fill="none" stroke="var(--border-color)" stroke-width="4.5">
            </circle>
            <circle class="timer-circle" cx="20" cy="20" r="18" fill="none" stroke-width="4.5"
              :stroke-dasharray="113.1"
              :style="{ 
                strokeDashoffset: 113.1 * (1 - timeLeft / (acc.period || 30)),
                transition: timeLeft > (acc.period || 30) - 0.5 ? 'all 0.2s ease-out' : ''
              }"
              transform="rotate(-90 20 20)"></circle>
          </svg>
        </div>
      </transition>
    </div>

    <div class="progress-bar-container" v-if="config.timerStyle === 'bar' && (acc.type || 'totp') !== 'hotp'">
      <div class="progress-bar" 
        :style="{ 
          width: (timeLeft / (acc.period || 30) * 100) + '%',
          transition: timeLeft > (acc.period || 30) - 0.5 ? 'all 0.2s ease-out' : ''
        }">
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 此处样式将继承或复制自 App.vue 中的相关卡片样式 */
</style>
