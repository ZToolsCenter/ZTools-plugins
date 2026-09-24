<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { LogLineParts } from './logFormat'
import { parseLogLine } from './logFormat'

const props = defineProps<{
  containerId: string
  running: boolean
}>()

const lines = ref<LogLineParts[]>([])
const following = ref(true)
const containerRef = ref<HTMLDivElement | null>(null)
let handle: { stop(): void } | null = null
let rafId = 0

function flush() {
  rafId = 0
  if (!containerRef.value) return
  containerRef.value.scrollTop = containerRef.value.scrollHeight
}

function stopFollow() {
  if (handle) { handle.stop(); handle = null }
}

function pushLine(raw: string) {
  lines.value.push(parseLogLine(raw))
  if (lines.value.length > 5000) lines.value.splice(0, lines.value.length - 5000)
}

function startFollow() {
  if (!props.running) return
  if (handle) stopFollow()   // 防止重复跟随导致子进程泄漏
  lines.value = []
  handle = window.services.docker.followLogs(props.containerId, (line) => {
    pushLine(line)
    if (following.value && !rafId) {
      rafId = requestAnimationFrame(flush)
    }
  }, (err) => {
    // LOG_CLOSED（正常退出/停止跟随）静默；其他错误提示
    if (err.code !== 'LOG_CLOSED') {
      pushLine(`[docker] ${err.message}`)
    }
  })
}

function toggleFollow() {
  following.value = !following.value
  if (following.value) {
    startFollow()
  } else {
    stopFollow()
  }
}

function scrollToBottom() {
  if (containerRef.value) containerRef.value.scrollTop = containerRef.value.scrollHeight
}

watch(() => props.containerId, () => {
  stopFollow()
  startFollow()
})
watch(() => props.running, (running) => {
  if (running) {
    // 用户暂停过跟随（按钮为"继续跟随"）时不自动恢复，保持暂停
    if (following.value) startFollow()
  } else {
    stopFollow(); lines.value = []
  }
})

onMounted(startFollow)
onBeforeUnmount(() => {
  stopFollow()
  if (rafId) cancelAnimationFrame(rafId)
})
</script>

<template>
  <div class="logs">
    <div class="logs-head">
      <span>实时日志</span>
      <button class="btn" :disabled="!running" @click="toggleFollow">
        <span class="btn-icon" :class="following ? 'icon-pause' : 'icon-play'"></span>
        {{ following ? '暂停跟随' : '继续跟随' }}
      </button>
      <button class="btn" @click="scrollToBottom">
        <span class="btn-icon icon-down"></span>到底部
      </button>
    </div>
    <div v-if="!running" class="logs-empty">容器未运行，无日志</div>
    <div v-else ref="containerRef" class="logs-body">
      <div v-for="(line, i) in lines" :key="i" class="log-line">
        <span v-if="line.prefix" class="log-prefix">{{ line.prefix }}</span>
        <span v-if="line.time" class="log-time">{{ line.time }}</span>{{ line.rest }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.logs { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.logs-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.logs-head span {
  font-size: 12px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-right: auto;
}
.logs-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.85);
  border-radius: 8px;
  padding: 8px 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.5;
}
@media (prefers-color-scheme: light) {
  .logs-body { color: #d4d4d4; }
}
.log-line { white-space: pre-wrap; word-break: break-all; }
.log-prefix { color: #9a9a9a; }
.log-time { color: #4ec9b0; font-weight: 600; margin-right: 2px; }
.logs-empty {
  color: var(--text-secondary);
  font-size: 13px;
  padding: 12px 0;
}
</style>
