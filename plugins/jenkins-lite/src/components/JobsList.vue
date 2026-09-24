<template>
  <div class="jobs-list" @click="focusPanel">
    <div class="jobs-header">
      <input
        ref="searchInputRef"
        v-model="searchQuery"
        type="text"
        class="search-input"
        placeholder="搜索 Jobs..."
        @focus="focusPanel"
      />
      <button class="refresh-btn" @click="refreshJobs" :disabled="loading">
        <span class="refresh-icon" :class="{ spinning: loading }"></span>
      </button>
    </div>

    <div class="keyboard-hint">
      <span><kbd>←</kbd><kbd>→</kbd> 切面板</span>
      <span><kbd>↑</kbd><kbd>↓</kbd> 同级</span>
      <span><kbd>⇧</kbd><kbd>↑</kbd><kbd>↓</kbd> 跨层</span>
      <span><kbd>Enter</kbd> 构建</span>
      <span><kbd>⌘</kbd><kbd>Enter</kbd> 收藏</span>
      <span><kbd>Esc</kbd> 关闭</span>
    </div>

    <div class="jobs-content">
      <div v-if="loading" class="loading">
        加载中...
      </div>

      <div v-else-if="error" class="error">
        {{ error }}
      </div>

      <div v-else-if="filteredJobs.length === 0" class="empty">
        没有找到 Jobs
      </div>

      <div v-else class="jobs" ref="jobsContentRef">
        <JobItem
          v-for="job in filteredJobs"
          :key="job.url"
          :job="job"
          :favorited="checkFavorited(job.fullName || job.name)"
          :show-full-name="props.currentView === '__favorites__'"
          :expanded-map="expandedFolders"
          :selected-path="selectedPath"
          :is-selected="isSelectedJob(job)"
          @toggle-favorite="handleToggleFavorite"
          @build="handleBuild"
          @click="handleJobClick"
          @toggle-expand="toggleExpand"
        />
      </div>
    </div>

    <!-- 构建确认弹窗 -->
    <div v-if="buildConfirmJob" class="modal-overlay" @click.self="cancelBuild">
      <div class="modal" ref="buildConfirmModalRef" tabindex="-1">
        <div class="modal-header">确认构建</div>
        <div class="modal-body">
          确定要触发 <strong>{{ buildConfirmJob.name }}</strong> 的构建吗？
          <div class="modal-hint">按 Enter 确认 / Esc 取消</div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-default" @click="cancelBuild">取消</button>
          <button class="btn btn-primary" @click="confirmBuild" :disabled="building" ref="buildConfirmOkRef">
            {{ building ? '构建中...' : '确认构建' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 收藏确认弹窗（键盘触发 Cmd+Enter 走二次确认） -->
    <div v-if="favoriteConfirmJob" class="modal-overlay" @click.self="cancelFavorite">
      <div class="modal" ref="favoriteConfirmModalRef" tabindex="-1">
        <div class="modal-header">确认收藏</div>
        <div class="modal-body">
          <template v-if="isJobFavorited(favoriteConfirmJob)">
            确定要取消 <strong>{{ favoriteConfirmJob.name }}</strong> 的收藏吗？
          </template>
          <template v-else>
            确定要收藏 <strong>{{ favoriteConfirmJob.name }}</strong> 吗？
          </template>
          <div class="modal-hint">按 Enter 确认 / Esc 取消</div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-default" @click="cancelFavorite">取消</button>
          <button class="btn btn-primary" @click="confirmFavorite" ref="favoriteConfirmOkRef">
            确认
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import JobItem from './JobItem.vue'
import { useInstances } from '../composables/useInstances'
import { useFavorites } from '../composables/useFavorites'
import { useBuildPolling } from '../composables/useBuildPolling'
import { useKeyboardNav } from '../composables/useKeyboardNav'
import { flattenFavoriteJobs } from '../utils/jobs'
import type { JobInfo, BuildInfo } from '../types'

const props = defineProps<{
  selectedJob?: string
  currentView?: string
  focusKey?: number
  initialQuery?: string
}>()

const emit = defineEmits<{
  (e: 'job-click', job: JobInfo): void
  (e: 'build-complete', result: { jobName: string; success: boolean }): void
  (e: 'focus-jobs'): void
}>()

const { currentInstance, currentClient, loadInstances } = useInstances()
const { isFavorited, toggleFavorite, loadFavorites, favorites } = useFavorites()
const { watchBuild, stopWatchingBuild } = useBuildPolling()
const nav = useKeyboardNav()

/**
 * 收藏的 Job 名称集合（响应式）
 */
const favoritedJobs = computed(() => {
  if (!currentInstance.value) return new Set<string>()
  return new Set(
    favorites.value
      .filter(f => f.instanceId === currentInstance.value?._id)
      .map(f => f.jobName)
  )
})

/**
 * 检查 Job 是否已收藏
 */
const checkFavorited = (jobName: string): boolean => {
  return favoritedJobs.value.has(jobName)
}

const isJobFavorited = (job: JobInfo | null): boolean => {
  if (!job) return false
  return checkFavorited(job.fullName || job.name)
}

const jobs = ref<JobInfo[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const searchQuery = ref(props.initialQuery || '')
const searchInputRef = ref<HTMLInputElement | null>(null)
const jobsContentRef = ref<HTMLElement | null>(null)
const buildConfirmJob = ref<JobInfo | null>(null)
const favoriteConfirmJob = ref<JobInfo | null>(null)
const building = ref(false)
const buildConfirmModalRef = ref<HTMLElement | null>(null)
const favoriteConfirmModalRef = ref<HTMLElement | null>(null)
const buildConfirmOkRef = ref<HTMLButtonElement | null>(null)
const favoriteConfirmOkRef = ref<HTMLButtonElement | null>(null)

/**
 * 关闭弹窗时把焦点还原到触发它的那条 Job（不是搜索框）
 */
const lastFocusedJobEl = ref<HTMLElement | null>(null)
const captureFocusForModal = () => {
  lastFocusedJobEl.value = document.activeElement as HTMLElement | null
}
const restoreFocusFromModal = () => {
  nextTick(() => {
    const el = lastFocusedJobEl.value
    if (el && typeof el.focus === 'function') {
      el.focus({ preventScroll: true })
    }
  })
  lastFocusedJobEl.value = null
}

/**
 * 受控的 Folder 展开集合（fullName 集合）
 */
const expandedFolders = ref<Set<string>>(new Set())

/**
 * 当前选中的 Job path（jobsParentPath + jobsIndex 派生）
 */
const selectedPath = computed<string | null>(() => {
  const siblings = getChildren(nav.jobsParentPath.value)
  const node = siblings[nav.jobsIndex.value]
  return node ? (node.fullName || node.name) : null
})

/**
 * 给 JobItem 用的高亮判定：path 全等
 */
const isSelectedJob = (job: JobInfo): boolean => {
  return (job.fullName || job.name) === selectedPath.value
}

/**
 * 获取 parentPath 下的直接子节点列表
 * parentPath=null 时返回顶级（filteredJobs 顶层）
 */
const getChildren = (parentPath: string | null): JobInfo[] => {
  if (parentPath === null || parentPath === '') return filteredJobs.value
  const node = findNode(filteredJobs.value, parentPath)
  return node?.jobs || []
}

/**
 * 递归查找节点
 */
const findNode = (jobList: JobInfo[], path: string): JobInfo | null => {
  for (const job of jobList) {
    const name = job.fullName || job.name
    if (name === path) return job
    if (job.jobs) {
      const found = findNode(job.jobs, path)
      if (found) return found
    }
  }
  return null
}

/**
 * 加载 Jobs
 */
const loadJobs = async () => {
  if (!currentClient.value) {
    jobs.value = []
    return
  }

  loading.value = true
  error.value = null

  let result
  // 收藏视图：加载所有 jobs，由 filteredJobs 过滤出收藏的
  if (props.currentView === '__favorites__') {
    result = await currentClient.value.getJobs()
  } else if (props.currentView) {
    result = await currentClient.value.getViewJobs(props.currentView)
  } else {
    result = await currentClient.value.getJobs()
  }

  if (result.error) {
    error.value = result.error
    jobs.value = []
  } else {
    jobs.value = result.data || []
  }

  loading.value = false
}

/**
 * 刷新 Jobs
 */
const refreshJobs = () => {
  loadJobs()
}

/**
 * 过滤 Jobs
 */
const filteredJobs = computed(() => {
  let list = jobs.value

  // 收藏视图：只显示收藏的 jobs
  if (props.currentView === '__favorites__') {
    list = flattenFavoriteJobs(list, favoritedJobs.value)
  }

  // 搜索过滤
  if (!searchQuery.value) return list

  const query = searchQuery.value.toLowerCase()
  return filterJobsRecursive(list, query)
})

/**
 * 递归过滤 Jobs（包括 Folder 内的 Jobs）
 */
const filterJobsRecursive = (jobList: JobInfo[], query: string): JobInfo[] => {
  const result: JobInfo[] = []

  for (const job of jobList) {
    if ((job.fullName || job.name).toLowerCase().includes(query)) {
      result.push(job)
    } else if (job.jobs && job.jobs.length > 0) {
      const filtered = filterJobsRecursive(job.jobs, query)
      if (filtered.length > 0) {
        result.push({
          ...job,
          jobs: filtered
        })
      }
    }
  }

  return result
}

/**
 * Folder 展开/收拢切换
 */
const toggleExpand = (job: JobInfo) => {
  const name = job.fullName || job.name
  const next = new Set(expandedFolders.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  expandedFolders.value = next
}

/**
 * 处理收藏切换（鼠标点击走即时路径，不弹确认）
 */
const handleToggleFavorite = (job: JobInfo) => {
  if (!currentInstance.value) return

  const instanceName = currentInstance.value.name
  const instanceId = currentInstance.value._id
  const viewName = props.currentView || 'all'

  toggleFavorite(instanceId, instanceName, job.fullName || job.name, viewName)
}

/**
 * 处理构建（鼠标点击 / 键盘 Enter 都走这里 → 弹出确认）
 */
const handleBuild = (job: JobInfo) => {
  captureFocusForModal()
  buildConfirmJob.value = job
  nextTick(() => buildConfirmModalRef.value?.focus())
}

const cancelBuild = () => {
  buildConfirmJob.value = null
  restoreFocusFromModal()
}

const confirmBuild = async () => {
  if (!buildConfirmJob.value || !currentClient.value) return

  building.value = true
  const jobName = buildConfirmJob.value.fullName || buildConfirmJob.value.name

  // 触发前抓基线最大 build number，用于后续识别本次触发的新 build
  const baselineResult = await currentClient.value.getBuilds(jobName)
  const baselineMax = baselineResult.data && baselineResult.data.length > 0
    ? Math.max(...baselineResult.data.map(b => b.number))
    : 0

  const result = await currentClient.value.triggerBuild(jobName)

  building.value = false
  buildConfirmJob.value = null
  restoreFocusFromModal()

  if (result.error) {
    window.ztools.showNotification(`构建触发失败: ${result.error}`, 'Jenkins Lite')
    return
  }

  window.ztools.showNotification(`${jobName} 构建已触发，正在监听结果...`, 'Jenkins Lite')
  // 刷新 Jobs 列表以更新状态
  setTimeout(() => loadJobs(), 2000)

  // 监听本次触发的 build 完成；watchBuild 会一直轮询直到目标 build 出现在队列并完成
  const targetBuildNumber = baselineMax + 1
  watchBuild(jobName, targetBuildNumber, (build: BuildInfo) => {
    const resultText = formatBuildResultForNotification(build.result)
    window.ztools.showNotification(
      `${jobName} #${build.number} 构建${resultText}`,
      'Jenkins Lite'
    )
    emit('build-complete', { jobName, success: build.result === 'SUCCESS' })
    if (props.selectedJob === jobName) {
      loadJobs()
    }
  })
}

/**
 * 构建结果 → 通知文案
 */
const formatBuildResultForNotification = (result: BuildInfo['result']): string => {
  if (result === 'SUCCESS') return '成功'
  if (result === 'FAILURE') return '失败'
  if (result === 'UNSTABLE') return '不稳定'
  if (result === 'ABORTED') return '已中止'
  return '结束'
}

/**
 * 收藏确认（键盘触发）
 */
const cancelFavorite = () => {
  favoriteConfirmJob.value = null
  restoreFocusFromModal()
}

const confirmFavorite = () => {
  if (!favoriteConfirmJob.value) return
  handleToggleFavorite(favoriteConfirmJob.value)
  favoriteConfirmJob.value = null
  restoreFocusFromModal()
}

/**
 * 处理 Job 点击
 */
const handleJobClick = (job: JobInfo) => {
  emit('job-click', job)
}

/**
 * 点击本面板任何位置 → 焦点切到 jobs
 */
const focusPanel = () => {
  if (nav.focusedPanel.value !== 'jobs') {
    nav.setFocusedPanel('jobs')
  }
  emit('focus-jobs')
}

// ========== 键盘导航接口（供 App.vue 的 window keydown 调用） ==========

/**
 * 获取父路径与同级 index
 */
const getParentInfo = (path: string): { parentPath: string | null; index: number } => {
  const segments = path.split('/')
  if (segments.length === 1) return { parentPath: null, index: 0 }
  const parentPath = segments.slice(0, -1).join('/')
  const siblings = getChildren(parentPath)
  const index = siblings.findIndex(j => (j.fullName || j.name) === path)
  return { parentPath, index: Math.max(0, index) }
}

/**
 * 限制 siblingIndex 合法范围
 */
const clampJobsIndex = () => {
  const siblings = getChildren(nav.jobsParentPath.value)
  if (siblings.length === 0) {
    nav.jobsIndex.value = 0
  } else if (nav.jobsIndex.value >= siblings.length) {
    nav.jobsIndex.value = siblings.length - 1
  } else if (nav.jobsIndex.value < 0) {
    nav.jobsIndex.value = 0
  }
}

/**
 * 当前选中节点（用于滚动入视等）
 */
const getCurrentNode = (): JobInfo | null => {
  const siblings = getChildren(nav.jobsParentPath.value)
  return siblings[nav.jobsIndex.value] || null
}

/**
 * 在同级内移动（plain ↑↓）
 */
const moveInSiblings = (delta: number) => {
  const siblings = getChildren(nav.jobsParentPath.value)
  if (siblings.length === 0) {
    nav.jobsParentPath.value = null
    nav.jobsIndex.value = 0
    return
  }
  nav.jobsIndex.value = Math.max(0, Math.min(siblings.length - 1, nav.jobsIndex.value + delta))
  scrollSelectedIntoView()
  syncRightPanelWithSelection()
}

/**
 * 跨层移动（Shift+↑↓）
 * delta=+1: 进入 Folder 的第一个子（若当前是 Folder 且已展开或将被自动展开）
 * delta=-1: 跳到父 Folder
 */
const moveTree = (delta: number) => {
  const current = getCurrentNode()
  if (!current) return
  const fullName = current.fullName || current.name

  if (delta > 0) {
    // Shift+Down: 进 Folder
    if (!current.jobs || current.jobs.length === 0) return
    // 自动展开
    if (!expandedFolders.value.has(fullName)) {
      const next = new Set(expandedFolders.value)
      next.add(fullName)
      expandedFolders.value = next
    }
    nav.jobsParentPath.value = fullName
    nav.jobsIndex.value = 0
  } else {
    // Shift+Up: 出到父 Folder
    if (!current.fullName || !current.fullName.includes('/')) return
    const parentInfo = getParentInfo(current.fullName)
    nav.jobsParentPath.value = parentInfo.parentPath
    nav.jobsIndex.value = parentInfo.index
  }
  clampJobsIndex()
  scrollSelectedIntoView()
  syncRightPanelWithSelection()
}

/**
 * 键盘移动选中项后，把当前 leaf job 自动同步给右侧构建历史面板
 * （Folder 不联动 —— Folder 不可构建）
 */
const syncRightPanelWithSelection = () => {
  const current = getCurrentNode()
  if (!current) return
  if (current.jobs && current.jobs.length > 0) return // Folder 跳过
  handleJobClick(current)
}

/**
 * 主操作（Enter）：
 * - Folder: 展开/收拢
 * - Leaf: 弹出构建确认
 */
const primaryAction = () => {
  const current = getCurrentNode()
  if (!current) return
  if (current.jobs && current.jobs.length > 0) {
    toggleExpand(current)
    return
  }
  handleBuild(current)
}

/**
 * 收藏操作（Cmd/Ctrl + Enter）：
 * - 仅 Leaf 触发，Folder 直接忽略
 * - 走二次确认弹窗
 */
const favoriteAction = () => {
  const current = getCurrentNode()
  if (!current) return
  if (current.jobs && current.jobs.length > 0) return // Folder 跳过
  captureFocusForModal()
  favoriteConfirmJob.value = current
  nextTick(() => favoriteConfirmModalRef.value?.focus())
}

/**
 * 把当前选中节点滚动入视
 */
const scrollSelectedIntoView = () => {
  nextTick(() => {
    const root = jobsContentRef.value
    if (!root) return
    const path = selectedPath.value
    if (!path) return
    const el = root.querySelector(`[data-job-path="${CSS.escape(path)}"]`) as HTMLElement | null
    if (el) el.scrollIntoView({ block: 'nearest' })
  })
}

// 暴露给 App.vue 的接口
defineExpose({
  focusPanel,
  moveInSiblings,
  moveTree,
  primaryAction,
  favoriteAction,
  handleEsc: () => {
    // 弹窗 Esc 关闭：优先最近的
    if (favoriteConfirmJob.value) cancelFavorite()
    else if (buildConfirmJob.value) cancelBuild()
  }
})

// 监听实例变化
watch(currentInstance, () => {
  loadJobs()
})

// 监听视图变化，重置选中路径
watch(() => props.currentView, () => {
  loadJobs()
  nav.jobsParentPath.value = null
  nav.jobsIndex.value = 0
})

// 监听 jobs 数据变化，调整 index 不越界
watch(filteredJobs, () => {
  clampJobsIndex()
})

// 当 Jobs 加载完成后，自动选中第一个（收藏视图除外）
watch(jobs, (newJobs) => {
  if (newJobs.length > 0 && !props.selectedJob && props.currentView !== '__favorites__') {
    const firstJob = getFirstJob(newJobs)
    if (firstJob) {
      handleJobClick(firstJob)
    }
  }
})

// 监听 focusKey，触发搜索框聚焦
watch(() => props.focusKey, (key) => {
  if (key) {
    nextTick(() => {
      searchInputRef.value?.focus()
    })
  }
})

// 获取第一个 Job（递归）
const getFirstJob = (jobList: JobInfo[]): JobInfo | null => {
  for (const job of jobList) {
    if (job.jobs) {
      const firstChild = getFirstJob(job.jobs)
      if (firstChild) return firstChild
      continue
    }
    return job
  }
  return null
}

onMounted(async () => {
  await loadInstances()
  loadFavorites()
  loadJobs()
})

/**
 * Esc 关闭当前打开的弹窗（优先收藏确认，其次构建确认）。
 * Enter 触发确认（按"确认"按钮）。
 * ZTools 主进程有内置"Esc 退出插件"行为，单靠 stopPropagation 不够；用 capture +
 * preventDefault + stopImmediatePropagation。
 * 焦点还原到打开弹窗的那条 Job（不是搜索框），由 cancelBuild / cancelFavorite
 * 里的 restoreFocusFromModal 处理。
 */
const handleEsc = () => {
  if (favoriteConfirmJob.value) cancelFavorite()
  else if (buildConfirmJob.value) cancelBuild()
}

const handleEnter = () => {
  // 构建中重复触发会重复构建，需拦截
  if (building.value) return
  if (favoriteConfirmJob.value) confirmFavorite()
  else if (buildConfirmJob.value) confirmBuild()
}

const handleWindowKeydown = (e: KeyboardEvent) => {
  if (!buildConfirmJob.value && !favoriteConfirmJob.value) return

  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    handleEsc()
    return
  }

  if (e.key === 'Enter') {
    // 不抢输入框里的 Enter（搜索框等）
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return
    }
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    handleEnter()
  }
}

window.addEventListener('keydown', handleWindowKeydown, { capture: true })

onUnmounted(() => {
  // 组件卸载时清掉所有未结束的 build watcher，避免内存泄漏
  stopWatchingBuild()
  window.removeEventListener('keydown', handleWindowKeydown, { capture: true } as any)
})
</script>

<style scoped>
.jobs-list {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.jobs-header {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.search-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  font-size: 13px;
  background: var(--bg-color, #fff);
  color: var(--text-color, #333);
}

.search-input:focus {
  outline: none;
  border-color: var(--primary-color, #0078d4);
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
  padding: 8px 12px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  background: var(--bg-color, #fff);
  cursor: pointer;
  transition: background 0.2s;
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

.jobs-content {
  flex: 1;
  overflow-y: auto;
}

.loading, .error, .empty {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary, #666);
}

.error {
  color: #ff4d4f;
}

.jobs {
  padding: 8px;
}

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
  z-index: 1000;
}

.modal {
  background: var(--bg-color, #fff);
  border-radius: 8px;
  width: 320px;
  overflow: hidden;
  outline: none;
}

.modal-header {
  padding: 16px;
  font-weight: 600;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.modal-body {
  padding: 24px 16px;
}

.modal-hint {
  margin-top: 12px;
  font-size: 11px;
  color: var(--text-secondary, #999);
}

.modal-footer {
  padding: 12px 16px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  border-top: 1px solid var(--border-color, #e0e0e0);
}

.btn {
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.btn-default {
  background: var(--bg-color, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  color: var(--text-color, #333);
}

.btn-primary {
  background: var(--primary-color, #0078d4);
  border: 1px solid var(--primary-color, #0078d4);
  color: #fff;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>