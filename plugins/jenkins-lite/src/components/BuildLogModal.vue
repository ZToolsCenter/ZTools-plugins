<template>
  <div class="modal-overlay" @click.self="handleClose">
    <div class="modal">
      <div class="modal-header">
        <div class="header-left">
          <span
            class="build-status-dot"
            :class="getBuildClass(build)"
          ></span>
          <span class="build-title">{{ jobName }} #{{ build.number }}</span>
          <span class="build-result">{{ getBuildResultText(build) }}</span>
        </div>
        <button class="close-btn" @click="handleClose" title="关闭">
          <span class="close-icon"></span>
        </button>
      </div>

      <div class="meta">
        <div class="meta-row">
          <span class="meta-label">开始</span>
          <span class="meta-value">{{ formatStartTime(build.timestamp) }}</span>
        </div>
        <div class="meta-row" v-if="!build.building && build.duration">
          <span class="meta-label">结束</span>
          <span class="meta-value">{{ formatEndTime(build.timestamp, build.duration) }}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">耗时</span>
          <span class="meta-value">{{ formatDuration(build.duration, build.building) }}</span>
        </div>
        <div class="meta-row meta-hint">
          <kbd>↑</kbd><kbd>↓</kbd> 滚动 ·
          <kbd>PgUp</kbd><kbd>PgDn</kbd> 翻页 ·
          <kbd>Home</kbd><kbd>End</kbd> 顶/底
        </div>
      </div>

      <div class="log-body" ref="logBodyRef">
        <div v-if="loading" class="log-loading">加载日志中...</div>
        <div v-else-if="error" class="log-error">{{ error }}</div>
        <div v-else-if="!consoleText" class="log-empty">暂无日志输出</div>
        <pre v-else class="log-pre">
          <span
            v-for="(line, idx) in consoleLines"
            :key="idx"
            class="log-line"
            :class="{ 'log-line-error': isErrorLine(line) }"
          >{{ line }}</span>
        </pre>
      </div>

      <div class="modal-footer">
        <button class="btn btn-default" @click="openInJenkins" title="在浏览器中打开 Jenkins 详情页">
          在 Jenkins 中打开
        </button>
        <div class="footer-right">
          <button class="btn btn-default" @click="copyErrorLog" :disabled="!errorLines.length || loading" :title="errorLines.length ? `共 ${errorLines.length} 行错误` : '没有错误行'">
            复制错误 <span v-if="errorLines.length" class="error-count">({{ errorLines.length }})</span>
          </button>
          <button class="btn btn-default" @click="copyLog" :disabled="!consoleText || loading">
            复制日志
          </button>
          <button class="btn btn-primary" @click="handleClose">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import type { BuildInfo } from '../types'
import { useInstances } from '../composables/useInstances'

const props = defineProps<{
  build: BuildInfo
  jobName: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { currentClient } = useInstances()
const consoleText = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const logBodyRef = ref<HTMLElement | null>(null)

/**
 * 关闭弹窗时把焦点还回打开它的那条 build（而不是跳去搜索框）
 */
let previouslyFocused: HTMLElement | null = null

/**
 * 弹窗打开时用 ↑↓ / PgUp / PgDn / Home / End 控制日志滚动条（替代面板间的选中移动）
 */
const handleScrollKeydown = (e: KeyboardEvent) => {
  if (!logBodyRef.value) return
  const el = logBodyRef.value
  const lineHeight = 18 // 与 .log-pre line-height 1.55 + font-size 12 ≈ 18px 同步
  let delta = 0

  if (e.key === 'ArrowDown') delta = lineHeight
  else if (e.key === 'ArrowUp') delta = -lineHeight
  else if (e.key === 'PageDown') delta = el.clientHeight - lineHeight
  else if (e.key === 'PageUp') delta = -(el.clientHeight - lineHeight)
  else if (e.key === 'Home') {
    el.scrollTop = 0
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    return
  } else if (e.key === 'End') {
    el.scrollTop = el.scrollHeight
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    return
  } else {
    return
  }

  if (delta !== 0) {
    el.scrollTop += delta
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
  }
}

window.addEventListener('keydown', handleScrollKeydown, { capture: true })

/**
 * 错误关键词：包含任一项的行会被标红高亮
 */
const ERROR_KEYWORDS = ['ERROR', 'Exception', 'FATAL', 'BUILD FAILURE', 'failed', 'Error:']

/**
 * 把日志按行拆分用于逐行渲染 + 错误高亮
 */
const consoleLines = computed(() => consoleText.value.split('\n'))

/**
 * 行级错误判定
 */
const isErrorLine = (line: string): boolean => {
  if (!line) return false
  return ERROR_KEYWORDS.some(kw => line.includes(kw))
}

/**
 * 仅含错误关键字的行（用于复制错误日志 / 计数显示）
 */
const errorLines = computed(() => consoleLines.value.filter(isErrorLine))

/**
 * 自动滚到日志末尾
 */
const scrollLogToBottom = () => {
  nextTick(() => {
    const el = logBodyRef.value
    if (!el) return
    el.scrollTop = el.scrollHeight
  })
}

/**
 * 拉取构建日志
 */
const fetchLog = async () => {
  if (!currentClient.value) {
    error.value = '未连接到 Jenkins'
    return
  }

  loading.value = true
  error.value = null
  consoleText.value = ''

  const result = await currentClient.value.getBuildConsole(props.jobName, props.build.number)

  if (result.error) {
    error.value = `加载失败: ${result.error}`
  } else {
    consoleText.value = result.data || ''
  }

  loading.value = false
}

const handleClose = () => {
  emit('close')
}

const openInJenkins = () => {
  if (props.build.url) {
    window.ztools.shellOpenExternal(props.build.url)
  }
}

const copyLog = () => {
  if (!consoleText.value) return
  window.ztools.copyText(consoleText.value)
  window.ztools.showNotification('日志已复制', 'Jenkins Lite')
}

/**
 * 仅复制错误行
 */
const copyErrorLog = () => {
  const lines = errorLines.value
  if (lines.length === 0) return
  window.ztools.copyText(lines.join('\n'))
  window.ztools.showNotification(`已复制 ${lines.length} 行错误日志`, 'Jenkins Lite')
}

/**
 * 状态样式
 */
const getBuildClass = (build: BuildInfo): string => {
  if (build.building) return 'building'
  if (build.result === 'SUCCESS') return 'success'
  if (build.result === 'FAILURE') return 'failure'
  if (build.result === 'UNSTABLE') return 'unstable'
  if (build.result === 'ABORTED') return 'aborted'
  return ''
}

const getBuildResultText = (build: BuildInfo): string => {
  if (build.building) return '运行中'
  if (build.result === 'SUCCESS') return '成功'
  if (build.result === 'FAILURE') return '失败'
  if (build.result === 'UNSTABLE') return '不稳定'
  if (build.result === 'ABORTED') return '中止'
  return ''
}

const formatStartTime = (timestamp: number): string => {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const formatEndTime = (timestamp: number, duration: number): string => {
  const endTimestamp = timestamp + duration
  const date = new Date(endTimestamp)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const formatDuration = (duration: number, building: boolean): string => {
  if (building) return '运行中...'
  if (!duration) return '-'
  const seconds = Math.floor(duration / 1000)
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  if (minutes > 0) return `${minutes}分${secs}秒`
  return `${secs}秒`
}

const pad = (n: number): string => n.toString().padStart(2, '0')

// 打开即拉日志；日志到达后自动滚到底部
watch(() => props.build.number, () => {
  fetchLog()
}, { immediate: true })

// 日志内容更新 → 滚到底
watch(consoleText, () => {
  scrollLogToBottom()
})

/**
 * Esc 关闭弹窗。
 * ZTools 主进程在 BrowserWindow 层面有内置"Esc 退出插件"行为，可能吃 stopPropagation。
 * 这里用最激进的组合：capture + preventDefault + stopImmediatePropagation。
 * 关闭后焦点还原到打开它的 build（不是搜索框），由 onUnmounted 里的 restoreFocus 处理。
 */
const handleKeydown = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return
  e.preventDefault()
  e.stopPropagation()
  e.stopImmediatePropagation()
  handleClose()
}

window.addEventListener('keydown', handleKeydown, { capture: true })

onMounted(() => {
  // 记录打开弹窗前的焦点元素（一般是点开的那条 build）
  previouslyFocused = document.activeElement as HTMLElement | null
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown, { capture: true } as any)
  window.removeEventListener('keydown', handleScrollKeydown, { capture: true } as any)
  // 还原焦点到打开弹窗的 build 条目，方便继续 ↑↓ / Enter 操作
  if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
    nextTick(() => previouslyFocused?.focus({ preventScroll: true }))
  }
})
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
}

.modal {
  background: var(--bg-color, #fff);
  border-radius: 8px;
  width: 720px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-color, #e0e0e0);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  overflow: hidden;
}

.build-status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.build-status-dot.success { background: #52c41a; }
.build-status-dot.failure { background: #ff4d4f; }
.build-status-dot.unstable { background: #faad14; }
.build-status-dot.aborted { background: #8c8c8c; }
.build-status-dot.building { background: #1890ff; animation: pulse 1.5s infinite; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.build-title {
  font-weight: 600;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.build-result {
  font-size: 12px;
  color: var(--text-secondary, #666);
}

.close-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.close-btn:hover {
  background: var(--bg-hover, #f0f0f0);
}

.close-icon {
  position: relative;
  width: 14px;
  height: 14px;
}
.close-icon::before,
.close-icon::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 0;
  width: 100%;
  height: 1.5px;
  background: var(--text-secondary, #888);
}
.close-icon::before { transform: rotate(45deg); }
.close-icon::after { transform: rotate(-45deg); }

.meta {
  display: flex;
  gap: 24px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--bg-secondary, #fafafa);
  flex-wrap: wrap;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.meta-hint {
  margin-left: auto;
  font-size: 10px;
  color: var(--text-secondary, #999);
}

.meta-hint kbd {
  display: inline-block;
  padding: 0 4px;
  min-width: 14px;
  text-align: center;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  color: var(--text-color, #333);
  background: var(--bg-color, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-bottom-width: 2px;
  border-radius: 3px;
  line-height: 14px;
  margin: 0 1px;
}

.error-count {
  color: #ff4d4f;
  font-weight: 600;
}

.meta-label {
  color: var(--text-secondary, #999);
}

.meta-value {
  color: var(--text-color, #333);
  font-variant-numeric: tabular-nums;
}

.log-body {
  flex: 1 1 auto;
  overflow: auto;
  background: var(--bg-secondary, #1e1e1e);
  min-height: 120px;
  /* 用 min/max-height 区间给 log-body 弹性空间，确保 footer 始终可见 */
}

.log-loading,
.log-error,
.log-empty {
  padding: 32px;
  text-align: center;
  color: var(--text-secondary, #888);
  font-size: 13px;
}

.log-error {
  color: #ff7875;
}

.log-pre {
  margin: 0;
  padding: 14px 16px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  color: #d4d4d4;
  white-space: pre-wrap;
  word-break: break-all;
}

.log-line {
  display: block;
}

.log-line-error {
  color: #ff7875;
  background: rgba(255, 77, 79, 0.12);
  border-left: 2px solid #ff4d4f;
  padding-left: 6px;
  margin-left: -8px;
}

.modal-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-top: 1px solid var(--border-color, #e0e0e0);
  background: var(--bg-color, #fff);
  flex: 0 0 auto; /* footer 永远在底部，不被压缩或滚动 */
}

.footer-right {
  display: flex;
  gap: 8px;
}

.btn {
  padding: 6px 14px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s, opacity 0.15s;
}

.btn-default {
  background: var(--bg-color, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  color: var(--text-color, #333);
}

.btn-default:hover:not(:disabled) {
  background: var(--bg-hover, #f0f0f0);
}

.btn-default:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--primary-color, #0078d4);
  border: 1px solid var(--primary-color, #0078d4);
  color: #fff;
}

.btn-primary:hover {
  filter: brightness(0.92);
}
</style>