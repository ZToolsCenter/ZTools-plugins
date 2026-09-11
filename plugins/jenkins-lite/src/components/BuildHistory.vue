<template>
  <div class="build-history" @click="focusPanel">
    <div class="history-header">
      <h3>构建历史</h3>
      <button class="refresh-btn" @click="refresh" :disabled="loading">
        <span class="refresh-icon" :class="{ spinning: loading }"></span>
      </button>
    </div>

    <div class="keyboard-hint">
      <span><kbd>←</kbd><kbd>→</kbd> 切面板</span>
      <span><kbd>↑</kbd><kbd>↓</kbd> 切换</span>
      <span><kbd>Enter</kbd> 查看日志</span>
      <span><kbd>Esc</kbd> 关闭</span>
    </div>

    <div v-if="!selectedJob" class="empty">
      选择一个 Job 查看构建历史
    </div>

    <div v-else-if="loading" class="loading">
      加载中...
    </div>

    <div v-else-if="error" class="error">
      {{ error }}
    </div>

    <div v-else-if="builds.length === 0" class="empty">
      暂无构建记录
    </div>

    <div v-else class="builds" ref="buildsRef">
      <div
        v-for="(build, idx) in builds"
        :key="build.number"
        class="build-item"
        :class="{ 'is-keyboard-selected': nav.focusedPanel.value === 'history' && nav.historyIndex.value === idx }"
        @click="openLog(build)"
        :data-build-index="idx"
      >
        <div class="build-main">
          <div class="build-info">
            <span
              class="build-status-dot"
              :class="getBuildClass(build)"
            ></span>
            <span class="build-number">#{{ build.number }}</span>
            <span class="build-result">{{ getBuildResultText(build) }}</span>
            <span class="build-duration">{{ formatDuration(build.duration, build.building) }}</span>
          </div>
          <div class="build-times">
            <div class="time-row">
              <span class="time-label">开始</span>
              <span class="time-value">{{ formatStartTime(build.timestamp) }}</span>
            </div>
            <div class="time-row" v-if="!build.building && build.duration">
              <span class="time-label">结束</span>
              <span class="time-value">{{ formatEndTime(build.timestamp, build.duration) }}</span>
            </div>
          </div>
        </div>
        <span class="build-link">→</span>
      </div>
    </div>

    <BuildLogModal
      v-if="logBuild"
      :build="logBuild"
      :job-name="props.selectedJob || ''"
      @close="closeLog"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted, nextTick } from 'vue'
import type { BuildInfo } from '../types'
import { useInstances } from '../composables/useInstances'
import { useBuildPolling } from '../composables/useBuildPolling'
import { useKeyboardNav } from '../composables/useKeyboardNav'
import BuildLogModal from './BuildLogModal.vue'

const props = defineProps<{
  selectedJob?: string
}>()

const { currentClient } = useInstances()
const { currentBuilds, startPolling, stopPolling } = useBuildPolling()
const nav = useKeyboardNav()

const builds = ref<BuildInfo[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const logBuild = ref<BuildInfo | null>(null)
const buildsRef = ref<HTMLElement | null>(null)

/**
 * 加载构建历史
 */
const loadBuilds = async () => {
  if (!props.selectedJob || !currentClient.value) {
    builds.value = []
    return
  }

  loading.value = true
  error.value = null

  const result = await currentClient.value.getBuilds(props.selectedJob)

  if (result.error) {
    error.value = result.error
    builds.value = []
  } else {
    builds.value = result.data || []
  }

  loading.value = false
}

/**
 * 刷新
 */
const refresh = () => {
  loadBuilds()
}

/**
 * 获取构建样式类
 */
const getBuildClass = (build: BuildInfo): string => {
  if (build.building) return 'building'
  if (build.result === 'SUCCESS') return 'success'
  if (build.result === 'FAILURE') return 'failure'
  if (build.result === 'UNSTABLE') return 'unstable'
  if (build.result === 'ABORTED') return 'aborted'
  return ''
}

/**
 * 获取构建结果文本
 */
const getBuildResultText = (build: BuildInfo): string => {
  if (build.building) return '运行中'
  if (build.result === 'SUCCESS') return '成功'
  if (build.result === 'FAILURE') return '失败'
  if (build.result === 'UNSTABLE') return '不稳定'
  if (build.result === 'ABORTED') return '中止'
  return ''
}

/**
 * 格式化开始时间（包含完整日期）
 */
const formatStartTime = (timestamp: number): string => {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}`
}

/**
 * 格式化结束时间（包含完整日期）
 */
const formatEndTime = (timestamp: number, duration: number): string => {
  const endTimestamp = timestamp + duration
  const date = new Date(endTimestamp)
  const year = date.getFullYear()
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}`
}

/**
 * 格式化持续时间
 */
const formatDuration = (duration: number, building: boolean): string => {
  if (building) {
    return '运行中...'
  }
  if (!duration) return '-'
  const seconds = Math.floor(duration / 1000)
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  if (minutes > 0) {
    return `${minutes}分${secs}秒`
  }
  return `${secs}秒`
}

/**
 * 格式化相对时间（用于显示）
 */
const formatTime = (timestamp: number): string => {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  return `${days}天前`
}

/**
 * 打开日志弹窗（替代原直接跳转 Jenkins 的行为）
 */
const openLog = (build: BuildInfo) => {
  logBuild.value = build
}

const closeLog = () => {
  logBuild.value = null
}

/**
 * 点击本面板任何位置 → 焦点切到 history
 */
const focusPanel = () => {
  if (nav.focusedPanel.value !== 'history') {
    nav.setFocusedPanel('history')
  }
}

/**
 * historyIndex 越界裁剪
 */
const clampHistoryIndex = () => {
  const n = builds.value.length
  if (n === 0) {
    nav.historyIndex.value = 0
  } else if (nav.historyIndex.value >= n) {
    nav.historyIndex.value = n - 1
  } else if (nav.historyIndex.value < 0) {
    nav.historyIndex.value = 0
  }
}

watch(builds, () => clampHistoryIndex())

/**
 * 同级内移动（↑↓）
 */
const moveInSiblings = (delta: number) => {
  const n = builds.value.length
  if (n === 0) return
  nav.historyIndex.value = Math.max(0, Math.min(n - 1, nav.historyIndex.value + delta))
  scrollSelectedIntoView()
}

/**
 * 主操作：打开选中条目的日志弹窗
 */
const primaryAction = () => {
  const target = builds.value[nav.historyIndex.value]
  if (target) openLog(target)
}

/**
 * 滚动选中项入视
 */
const scrollSelectedIntoView = () => {
  nextTick(() => {
    const root = buildsRef.value
    if (!root) return
    const el = root.querySelector(`[data-build-index="${nav.historyIndex.value}"]`) as HTMLElement | null
    if (el) el.scrollIntoView({ block: 'nearest' })
  })
}

defineExpose({
  focusPanel,
  moveInSiblings,
  primaryAction,
  handleEsc: () => {
    if (logBuild.value) closeLog()
  }
})

// 监听选中 Job 变化
watch(() => props.selectedJob, (job) => {
  if (job) {
    loadBuilds()
    startPolling(job)
  } else {
    stopPolling()
    builds.value = []
  }
})

// 监听轮询结果变化
watch(currentBuilds, (newBuilds) => {
  if (newBuilds.length > 0) {
    builds.value = newBuilds
  }
})

onUnmounted(() => {
  stopPolling()
})
</script>

<style scoped>
.build-history {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.history-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.keyboard-hint {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  padding: 6px 12px;
  font-size: 10px;
  color: var(--text-secondary, #999);
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--bg-secondary, #fafafa);
  line-height: 1.6;
}

.keyboard-hint kbd {
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

.refresh-btn {
  padding: 4px 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 4px;
}

.refresh-btn:hover:not(:disabled) {
  background: var(--bg-hover, #f0f0f0);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.refresh-icon {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--text-secondary, #888);
  border-top-color: transparent;
  border-radius: 50%;
}

.refresh-icon.spinning {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.empty, .loading, .error {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary, #666);
  font-size: 13px;
}

.error {
  color: #ff4d4f;
}

.builds {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.build-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  margin-bottom: 4px;
  background: var(--bg-color, #fff);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
}

.build-item:hover {
  background: var(--bg-hover, #f5f5f5);
}

.build-item.is-keyboard-selected {
  background: var(--primary-bg, rgba(0, 120, 212, 0.15));
  box-shadow: inset 2px 0 0 var(--primary-color, #0078d4);
}

.build-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.build-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.build-status-dot {
  width: 8px;
  height: 8px;
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

.build-number {
  font-weight: 500;
  font-size: 13px;
}

.build-result {
  font-size: 12px;
  color: var(--text-secondary, #666);
}

.build-duration {
  font-size: 12px;
  color: var(--text-secondary, #888);
}

.build-times {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: 16px;
}

.time-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.time-label {
  font-size: 11px;
  color: var(--text-secondary, #999);
  min-width: 24px;
}

.time-value {
  font-size: 11px;
  color: var(--text-secondary, #888);
}

.build-link {
  color: var(--text-secondary, #999);
  font-size: 14px;
  opacity: 0;
  transition: opacity 0.2s;
}

.build-item:hover .build-link {
  opacity: 1;
}
</style>
