<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'

type TaskStatus = 'waiting' | 'hashing' | 'done' | 'error'
type HashCase = 'lowercase' | 'uppercase'

type BaseHashTask = {
  id: string
  kind: 'file' | 'text'
  name: string
  size: number
  status: TaskStatus
  progress: number
  error: string
  algorithms: HashAlgorithm[]
  hashes: HashResult | null
  displayCases: Partial<Record<HashAlgorithm, HashCase>>
}

type FileHashTask = BaseHashTask &
  FileInfo & {
    kind: 'file'
  }

type TextHashTask = BaseHashTask & {
  kind: 'text'
  path: ''
  text: string
}

type HashTask = FileHashTask | TextHashTask

type PluginFileEnterAction = {
  type: string
  payload?: Array<{ path?: string }>
}

type Settings = {
  largeFileWarningEnabled: boolean
  largeFileWarningThresholdGB: number
  extraAlgorithms: ExtraHashAlgorithm[]
  defaultCase: HashCase
}

const SETTINGS_KEY = 'my-hash-tool.settings'
const DEFAULT_SETTINGS: Settings = {
  largeFileWarningEnabled: true,
  largeFileWarningThresholdGB: 2,
  extraAlgorithms: [],
  defaultCase: 'lowercase'
}
const BYTES_PER_GB = 1024 * 1024 * 1024
const CORE_HASH_ALGORITHMS: CoreHashAlgorithm[] = ['md5', 'sha1', 'sha256']
const EXTRA_HASH_ALGORITHMS: ExtraHashAlgorithm[] = ['crc32', 'sha384', 'sha512']
const HASH_ALGORITHM_LABELS: Record<HashAlgorithm, string> = {
  md5: 'MD5',
  sha1: 'SHA1',
  sha256: 'SHA256',
  crc32: 'CRC32',
  sha384: 'SHA384',
  sha512: 'SHA512'
}

const tasks = ref<HashTask[]>([])
const textInput = ref('')
const inputRepresentsFiles = ref(false)
const isDragging = ref(false)
const isHashing = ref(false)
const cancelRequested = ref(false)
const isUnmounted = ref(false)
const copiedKey = ref('')
const warningFiles = ref<FileInfo[]>([])
const warningVisible = ref(false)
const disableFutureWarnings = ref(false)
const settings = reactive<Settings>({ ...DEFAULT_SETTINGS })
const completionToast = ref('')
const completionToastTone = ref<'neutral' | 'error'>('neutral')
const settingsOpen = ref(false)
let completionToastTimer: ReturnType<typeof setTimeout> | null = null

const thresholdInput = computed({
  get: () => String(settings.largeFileWarningThresholdGB),
  set: (value: string) => {
    const nextValue = Number(value)
    if (Number.isFinite(nextValue) && nextValue >= 1 && nextValue <= 1024) {
      settings.largeFileWarningThresholdGB = nextValue
    }
  }
})

const taskSummary = computed(() => {
  const summary = { total: tasks.value.length, done: 0, hashing: 0, waiting: 0, error: 0 }
  for (const task of tasks.value) summary[task.status] += 1
  return summary
})

const batchProgress = computed(() => {
  if (!tasks.value.length) return 0
  const totalProgress = tasks.value.reduce((sum, task) => sum + task.progress, 0)
  return Math.round(totalProgress / tasks.value.length)
})

const enabledAlgorithms = computed<HashAlgorithm[]>(() => [
  ...CORE_HASH_ALGORITHMS,
  ...settings.extraAlgorithms
])

const warningSummary = computed(() => {
  const totalSize = warningFiles.value.reduce((sum, file) => sum + file.size, 0)
  return { count: warningFiles.value.length, totalSize }
})

const hasDoneTasks = computed(() => tasks.value.some((t) => t.status === 'done'))

function loadSettings() {
  try {
    const saved = window.ztools?.dbStorage?.getItem<Partial<Settings>>(SETTINGS_KEY)
    Object.assign(settings, normalizeSettings(saved))
    return
  } catch { /* dbStorage 不可用时降级到 localStorage */ }
  try {
    const saved = window.localStorage.getItem(SETTINGS_KEY)
    Object.assign(settings, normalizeSettings(saved ? JSON.parse(saved) : null))
  } catch {
    Object.assign(settings, { ...DEFAULT_SETTINGS })
    try { window.localStorage.removeItem(SETTINGS_KEY) } catch { /* ignore */ }
  }
}

function saveSettings() {
  const nextSettings = normalizeSettings(settings)
  Object.assign(settings, nextSettings)
  try {
    window.ztools?.dbStorage?.setItem(SETTINGS_KEY, nextSettings)
  } catch {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(nextSettings))
  }
}

function normalizeSettings(value?: Partial<Settings> | null): Settings {
  const threshold = Number(value?.largeFileWarningThresholdGB)
  const extraAlgorithms = Array.isArray(value?.extraAlgorithms)
    ? value.extraAlgorithms.filter((a): a is ExtraHashAlgorithm =>
        EXTRA_HASH_ALGORITHMS.includes(a as ExtraHashAlgorithm))
    : value?.extraAlgorithms === undefined ? DEFAULT_SETTINGS.extraAlgorithms : []
  return {
    largeFileWarningEnabled:
      typeof value?.largeFileWarningEnabled === 'boolean'
        ? value.largeFileWarningEnabled
        : DEFAULT_SETTINGS.largeFileWarningEnabled,
    largeFileWarningThresholdGB:
      Number.isFinite(threshold) && threshold >= 1 && threshold <= 1024
        ? Number(threshold.toFixed(2))
        : DEFAULT_SETTINGS.largeFileWarningThresholdGB,
    extraAlgorithms: Array.from(new Set(extraAlgorithms)),
    defaultCase:
      value?.defaultCase === 'lowercase' || value?.defaultCase === 'uppercase'
        ? value.defaultCase
        : DEFAULT_SETTINGS.defaultCase
  }
}

function updateThreshold() { saveSettings() }
function openSettings() { settingsOpen.value = true }
function closeSettings() { saveSettings(); settingsOpen.value = false }

function selectFiles() {
  if (isHashing.value) return
  withServices((services) => { handleFiles(services.selectFiles()) }, '选择文件失败')
}

function hashTextInput() {
  if (isHashing.value || inputRepresentsFiles.value) return
  const text = textInput.value
  if (!text.length) { notifyError('请输入需要计算 Hash 的字符串，或拖入文件', '输入为空'); return }
  startTextHashing(text)
}

function handleDragEnter(event: DragEvent) {
  if (isHashing.value) return
  event.preventDefault()
  isDragging.value = true
}

function handleDragOver(event: DragEvent) {
  if (isHashing.value) return
  event.preventDefault()
  if (!isDragging.value) isDragging.value = true
}

function handleDragLeave(event: DragEvent) {
  const related = event.relatedTarget
  const current = event.currentTarget as HTMLElement
  if (!related || !(related instanceof Node) || !current.contains(related)) {
    isDragging.value = false
  }
}

function handleDrop(event: DragEvent) {
  event.preventDefault()
  isDragging.value = false
  if (isHashing.value) return
  const files = event.dataTransfer?.files
  if (!files?.length) return
  withServices((services) => { handleFiles(services.getDroppedFileInfos(files)) }, '读取文件信息失败')
}

function clearTasks() {
  if (isHashing.value) return
  tasks.value = []
  textInput.value = ''
  inputRepresentsFiles.value = false
  copiedKey.value = ''
}

function handleFiles(files: FileInfo[]) {
  if (!files.length) return
  const normalizedFiles = dedupeFiles(files)
  textInput.value = normalizedFiles.map((f) => f.path).join('\n')
  inputRepresentsFiles.value = true
  if (shouldWarnLargeFiles(normalizedFiles)) {
    warningFiles.value = normalizedFiles
    warningVisible.value = true
    disableFutureWarnings.value = false
    return
  }
  void startHashing(normalizedFiles)
}

function dedupeFiles(files: FileInfo[]) {
  const seen = new Set<string>()
  return files.filter((f) => { if (seen.has(f.path)) return false; seen.add(f.path); return true })
}

function shouldWarnLargeFiles(files: FileInfo[]) {
  if (!settings.largeFileWarningEnabled) return false
  const thresholdBytes = settings.largeFileWarningThresholdGB * BYTES_PER_GB
  const totalSize = files.reduce((sum, f) => sum + f.size, 0)
  return totalSize > thresholdBytes || files.some((f) => f.size > thresholdBytes)
}

function continueAfterWarning() {
  if (disableFutureWarnings.value) { settings.largeFileWarningEnabled = false; saveSettings() }
  warningVisible.value = false
  void startHashing(warningFiles.value)
}

function cancelWarning() {
  warningVisible.value = false
  warningFiles.value = []
  disableFutureWarnings.value = false
}

async function startHashing(files: FileInfo[]) {
  const algorithms = enabledAlgorithms.value
  tasks.value = files.map((file) => createTask(file, algorithms))
  isHashing.value = true
  cancelRequested.value = false

  for (const task of tasks.value) {
    if (cancelRequested.value) {
      task.status = 'error'; task.error = '已取消'; task.progress = 0
      continue
    }
    task.status = 'hashing'; task.error = ''; task.progress = 0
    try {
      task.hashes = await window.services.hashFile(task.path, task.algorithms, (progress) => {
        task.progress = Math.round(progress.progress)
      })
      task.progress = 100; task.status = 'done'
    } catch (error) {
      task.status = 'error'; task.error = getErrorMessage(error); task.progress = 0
    }
  }

  isHashing.value = false
  cancelRequested.value = false
  notifyBatchFinished(tasks.value)
}

function cancelHashing() {
  if (!isHashing.value) return
  cancelRequested.value = true
}

function startTextHashing(text: string) {
  const task = createTextTask(text, enabledAlgorithms.value)
  tasks.value = [task]
  isHashing.value = true
  task.status = 'hashing'
  task.progress = 35
  window.setTimeout(() => {
    try {
      task.hashes = window.services.hashText(text, task.algorithms)
      task.progress = 100; task.status = 'done'
    } catch (error) {
      task.status = 'error'; task.error = getErrorMessage(error); task.progress = 0
    } finally {
      isHashing.value = false
    }
  }, 80)
}

function buildInitialDisplayCases(algorithms: HashAlgorithm[]): Partial<Record<HashAlgorithm, HashCase>> {
  const result: Partial<Record<HashAlgorithm, HashCase>> = {}
  for (const a of algorithms) result[a] = settings.defaultCase
  return result
}

function createTask(file: FileInfo, algorithms: HashAlgorithm[]): FileHashTask {
  return {
    ...file,
    id: `${file.path}-${file.size}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind: 'file', status: 'waiting', progress: 0, error: '',
    algorithms: [...algorithms], hashes: null,
    displayCases: buildInitialDisplayCases(algorithms)
  }
}

function createTextTask(text: string, algorithms: HashAlgorithm[]): TextHashTask {
  return {
    id: `text-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind: 'text', path: '', text, name: '字符串输入',
    size: new TextEncoder().encode(text).length,
    status: 'waiting', progress: 0, error: '',
    algorithms: [...algorithms], hashes: null,
    displayCases: buildInitialDisplayCases(algorithms)
  }
}

function getStatusText(task: HashTask) {
  if (task.status === 'waiting') return '等待计算'
  if (task.status === 'hashing') return '正在计算'
  if (task.status === 'done') return '计算完成'
  return task.kind === 'file' ? `读取失败：${task.error}` : `计算失败：${task.error}`
}

function applyCase(value: string, displayCase: HashCase) {
  return displayCase === 'uppercase' ? value.toUpperCase() : value.toLowerCase()
}

function getDisplayedHash(task: HashTask, algorithm: HashAlgorithm) {
  const raw = task.hashes?.[algorithm]
  if (!raw) return ''
  return applyCase(raw, task.displayCases[algorithm] ?? 'lowercase')
}

function getHashValue(task: HashTask, algorithm: HashAlgorithm) {
  if (task.status === 'done' && task.hashes) return getDisplayedHash(task, algorithm) || '未计算'
  if (task.status === 'error') return '未计算'
  if (task.status === 'waiting') return '等待计算'
  return '正在计算...'
}

function getRowCase(task: HashTask, algorithm: HashAlgorithm): HashCase {
  return task.displayCases[algorithm] ?? 'lowercase'
}

function isRowCaseToggleEnabled(task: HashTask) { return task.status === 'done' }

function getRowCaseToggleLabel(task: HashTask, algorithm: HashAlgorithm) {
  const target = getRowCase(task, algorithm) === 'uppercase' ? '小写' : '大写'
  return `切换 ${HASH_ALGORITHM_LABELS[algorithm]} 为${target}`
}

function toggleRowCase(task: HashTask, algorithm: HashAlgorithm) {
  if (!isRowCaseToggleEnabled(task)) return
  task.displayCases[algorithm] = getRowCase(task, algorithm) === 'uppercase' ? 'lowercase' : 'uppercase'
}

async function copyHash(task: HashTask, algorithm: HashAlgorithm) {
  if (!task.hashes) return
  const value = getDisplayedHash(task, algorithm)
  if (!value) return
  if (!(await copyText(value))) return
  copiedKey.value = `${task.id}-${algorithm}`
  window.setTimeout(() => { if (copiedKey.value === `${task.id}-${algorithm}`) copiedKey.value = '' }, 1500)
}

async function copyTaskHashes(task: HashTask) {
  if (!task.hashes) return
  if (!(await copyText(formatTaskHashes(task)))) return
  copiedKey.value = `${task.id}-all`
  window.setTimeout(() => { if (copiedKey.value === `${task.id}-all`) copiedKey.value = '' }, 1500)
}

async function copyAllHashes() {
  const doneTasks = tasks.value.filter((t) => t.status === 'done' && t.hashes)
  if (!doneTasks.length) return
  if (!(await copyText(doneTasks.map(formatTaskHashes).join('\n\n')))) return
  copiedKey.value = 'all-results'
  window.setTimeout(() => { if (copiedKey.value === 'all-results') copiedKey.value = '' }, 1500)
}

async function copyText(value: string) {
  try {
    if (!window.ztools?.copyText?.(value)) await navigator.clipboard.writeText(value)
  } catch (error) { notifyError(error, '复制失败'); return false }
  return true
}

function formatTaskHashes(task: HashTask) {
  if (!task.hashes) return ''
  const title = task.kind === 'file' ? task.path : '字符串输入'
  return [title, ...task.algorithms.map((a) => `${HASH_ALGORITHM_LABELS[a]}: ${getDisplayedHash(task, a) || '未计算'}`)].join('\n')
}

function toggleExtraAlgorithm(algorithm: ExtraHashAlgorithm, enabled: boolean) {
  const next = new Set(settings.extraAlgorithms)
  enabled ? next.add(algorithm) : next.delete(algorithm)
  settings.extraAlgorithms = EXTRA_HASH_ALGORITHMS.filter((a) => next.has(a))
  saveSettings()
}

function isExtraAlgorithmEnabled(algorithm: ExtraHashAlgorithm) {
  return settings.extraAlgorithms.includes(algorithm)
}

function setDefaultCase(value: HashCase) {
  if (settings.defaultCase === value) return
  settings.defaultCase = value
  saveSettings()
}

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const v = bytes / 1024 ** i
  return `${v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`
}

function getTaskMeta(task: HashTask) {
  if (task.kind === 'text') return `${task.text.length} 个字符 / ${formatBytes(task.size)}`
  return task.path
}

function getTaskSize(task: HashTask) {
  return task.kind === 'text' ? 'UTF-8' : formatBytes(task.size)
}

function handleTextInput() { inputRepresentsFiles.value = false }

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return '未知错误'
}

function notifyError(error: unknown, title: string) {
  showCompletionToast(`${title}：${getErrorMessage(error)}`, 'error')
}

function withServices<T>(fn: (services: Services) => T, errorTitle: string): T | undefined {
  if (!window.services) {
    notifyError('请在 ZTools 中操作，浏览器预览仅用于查看界面', '当前环境不可用')
    return
  }
  try { return fn(window.services) } catch (error) { notifyError(error, errorTitle) }
}

function notifyBatchFinished(finishedTasks: HashTask[]) {
  if (finishedTasks.length <= 1) return
  const failedCount = finishedTasks.filter((t) => t.status === 'error').length
  const doneCount = finishedTasks.length - failedCount
  const message = failedCount
    ? `Hash 计算完成：${doneCount} 个成功，${failedCount} 个失败`
    : `Hash 计算完成：${doneCount} 个文件已处理`
  showCompletionToast(message, 'neutral')
}

function showCompletionToast(message: string, tone: 'neutral' | 'error' = 'neutral') {
  completionToast.value = message
  completionToastTone.value = tone
  if (completionToastTimer !== null) window.clearTimeout(completionToastTimer)
  completionToastTimer = window.setTimeout(() => { completionToast.value = ''; completionToastTimer = null }, 2600)
}

function handlePluginEnter(action: PluginFileEnterAction) {
  if (isUnmounted.value) return
  settingsOpen.value = false
  if (action.type !== 'files' || !Array.isArray(action.payload)) return
  if (isHashing.value) { showCompletionToast('正在计算中，请稍后再添加文件', 'error'); return }
  const paths = action.payload.map((item: { path?: string }) => item.path).filter((p): p is string => Boolean(p))
  if (!paths.length) return
  withServices((services) => { handleFiles(services.getFileInfos(paths)) }, '读取文件信息失败')
}

function handlePluginOut() {
  if (isUnmounted.value) return
  isDragging.value = false
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape' && settingsOpen.value) {
    closeSettings()
  }
}

onMounted(() => {
  loadSettings()
  window.ztools?.onPluginEnter?.(handlePluginEnter)
  window.ztools?.onPluginOut?.(handlePluginOut)
  window.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  isUnmounted.value = true
  cancelRequested.value = true
  isDragging.value = false
  if (completionToastTimer !== null) { window.clearTimeout(completionToastTimer); completionToastTimer = null }
  window.removeEventListener('keydown', handleKeyDown)
})
</script>

<template>
  <main
    class="app-shell"
    :class="{ 'is-drop-target': isDragging }"
    @dragenter="handleDragEnter"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <!-- ── 顶部 header ── -->
    <header class="main-actions">
      <span class="algorithm-note">{{ enabledAlgorithms.map((a) => HASH_ALGORITHM_LABELS[a]).join(' / ') }}</span>
      <div class="main-action-buttons">
        <button
          v-if="!isHashing && hasDoneTasks"
          class="secondary-button"
          type="button"
          title="复制全部已完成结果"
          @click="copyAllHashes"
        >
          {{ copiedKey === 'all-results' ? '已复制全部' : '复制全部结果' }}
        </button>
        <button class="icon-button" type="button" title="设置" @click="openSettings">设置</button>
      </div>
    </header>

    <!-- ── 输入区 ── -->
    <section
      class="input-zone"
      :class="{ 'is-dragging': isDragging, 'is-busy': isHashing, 'is-file-mode': inputRepresentsFiles }"
    >
      <!-- 文件模式：紧凑标签列表 -->
      <template v-if="inputRepresentsFiles">
        <span class="input-label">已选择 {{ textInput.split('\n').filter(Boolean).length }} 个文件</span>
        <ul class="file-chips" aria-label="已选择的文件">
          <li
            v-for="line in textInput.split('\n').filter(Boolean)"
            :key="line"
            class="file-chip"
            :title="line"
          >
            <span class="file-chip__icon" aria-hidden="true">📄</span>
            <span class="file-chip__name">{{ line.split('/').pop() || line.split('\\').pop() || line }}</span>
          </li>
        </ul>
        <div class="input-actions">
          <button
            v-if="!isHashing"
            class="secondary-button"
            type="button"
            title="清空当前任务"
            @click="clearTasks"
          >清空</button>
          <button class="primary-button" type="button" :disabled="isHashing" @click="selectFiles">
            重新选择
          </button>
        </div>
      </template>

      <!-- 字符串模式 -->
      <template v-else>
        <label class="input-label" for="hash-input">
          {{ isDragging ? '松开开始计算文件 Hash' : '输入字符串或拖入文件' }}
        </label>
        <textarea
          id="hash-input"
          v-model="textInput"
          :disabled="isHashing"
          spellcheck="false"
          placeholder="在这里输入或粘贴字符串；也可以把文件拖到这个区域。"
          @input="handleTextInput"
          @keydown.meta.enter.prevent="hashTextInput"
          @keydown.ctrl.enter.prevent="hashTextInput"
        ></textarea>
        <div class="input-actions">
          <span class="shortcut-hint">⌘/Ctrl + Enter 计算字符串</span>
          <button
            class="secondary-button"
            type="button"
            :disabled="isHashing"
            @click="hashTextInput"
          >计算字符串</button>
          <button class="primary-button" type="button" :disabled="isHashing" @click="selectFiles">
            选择文件
          </button>
        </div>
      </template>
    </section>

    <!-- ── 批量进度（内联轻量条） ── -->
    <div v-if="tasks.length > 1" class="batch-bar" aria-label="任务汇总">
      <div class="batch-bar__info">
        <span class="batch-bar__label">{{ isHashing ? '批量计算中' : '批量计算完成' }}</span>
        <span class="batch-bar__stats">
          <span>{{ taskSummary.total }} 项</span>
          <span>{{ taskSummary.done }} 完成</span>
          <span v-if="taskSummary.hashing">{{ taskSummary.hashing }} 计算中</span>
          <span v-if="taskSummary.waiting">{{ taskSummary.waiting }} 等待</span>
          <span v-if="taskSummary.error">{{ taskSummary.error }} 失败</span>
        </span>
        <strong class="batch-bar__pct">{{ batchProgress }}%</strong>
        <button
          v-if="isHashing"
          class="text-button batch-bar__cancel"
          type="button"
          title="取消剩余批处理任务"
          :disabled="cancelRequested"
          @click="cancelHashing"
        >{{ cancelRequested ? '正在取消…' : '取消' }}</button>
      </div>
      <div class="batch-bar__track" aria-hidden="true">
        <span class="batch-bar__fill" :style="{ width: `${batchProgress}%` }"></span>
      </div>
    </div>

    <!-- ── 空状态 / 任务列表 ── -->
    <Transition name="fade-in" mode="out-in">
      <section v-if="!tasks.length" key="empty" class="empty-state">
        <div class="empty-state__icon" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="6" y="4" width="22" height="28" rx="3" stroke="currentColor" stroke-width="1.8" fill="none"/>
            <path d="M22 4v8h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M11 18h12M11 23h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            <circle cx="30" cy="30" r="7" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1.6"/>
            <path d="M27.5 30h5M30 27.5v5" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </div>
        <h2>拖入文件，或点击「选择文件」</h2>
        <p>也可以在上方输入框粘贴字符串后点击「计算字符串」</p>
        <p class="empty-state__hint">文件会分块流式读取，已启用的算法在同一遍文件流中完成</p>
      </section>

      <section v-else key="tasks" class="task-list" aria-label="Hash 计算结果">
        <article
          v-for="task in tasks"
          :key="task.id"
          class="task-card"
          :class="`is-${task.status}`"
        >
          <div class="task-card__header">
            <div class="file-title">
              <h2 :title="task.kind === 'file' ? task.path : task.text">
                <span class="file-title__name">{{ task.name }}</span>
              </h2>
              <p :title="task.kind === 'file' ? task.path : task.text">{{ getTaskMeta(task) }}</p>
            </div>
            <div class="task-card__tools">
              <span class="file-size">{{ getTaskSize(task) }}</span>
              <button
                v-if="task.status === 'done'"
                class="copy-button"
                type="button"
                title="复制该项全部 Hash"
                @click="copyTaskHashes(task)"
              >{{ copiedKey === `${task.id}-all` ? '已复制' : '复制全部' }}</button>
            </div>
          </div>

          <div class="progress-meta">
            <span>{{ getStatusText(task) }}</span>
            <div class="progress-meta__right">
              <!-- 全部小写/大写：移到卡片内，仅完成时显示 -->
              <template v-if="task.status === 'done'">
                <button class="text-button text-button--case" type="button" title="将此项结果统一为小写" @click="() => { for (const a of task.algorithms) task.displayCases[a] = 'lowercase' }">全部小写</button>
                <button class="text-button text-button--case" type="button" title="将此项结果统一为大写" @click="() => { for (const a of task.algorithms) task.displayCases[a] = 'uppercase' }">全部大写</button>
              </template>
              <span>{{ task.progress }}%</span>
            </div>
          </div>
          <div
            class="progress-track"
            role="progressbar"
            :aria-valuenow="task.progress"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="`${task.name} 计算进度`"
          >
            <div class="progress-fill" :style="{ width: `${task.progress}%` }"></div>
          </div>

          <dl class="hash-list">
            <div v-for="algorithm in task.algorithms" :key="algorithm" class="hash-row">
              <dt>{{ HASH_ALGORITHM_LABELS[algorithm] }}</dt>
              <dd>
                <button
                  type="button"
                  class="hash-value"
                  :class="{ 'is-interactive': task.status === 'done' }"
                  :disabled="task.status !== 'done'"
                  :title="task.status === 'done' ? getDisplayedHash(task, algorithm) : getHashValue(task, algorithm)"
                  @click="task.status === 'done' && copyHash(task, algorithm)"
                >{{ getHashValue(task, algorithm) }}</button>
                <button
                  type="button"
                  class="case-toggle"
                  :class="{ 'is-disabled': !isRowCaseToggleEnabled(task) }"
                  :aria-disabled="isRowCaseToggleEnabled(task) ? 'false' : 'true'"
                  :aria-label="getRowCaseToggleLabel(task, algorithm)"
                  :tabindex="isRowCaseToggleEnabled(task) ? 0 : -1"
                  :title="isRowCaseToggleEnabled(task) ? getRowCaseToggleLabel(task, algorithm) : '计算完成后可切换大小写'"
                  @click="toggleRowCase(task, algorithm)"
                  @keydown.enter.prevent="toggleRowCase(task, algorithm)"
                  @keydown.space.prevent="toggleRowCase(task, algorithm)"
                >{{ getRowCase(task, algorithm) === 'uppercase' ? 'aa' : 'AA' }}</button>
                <span
                  v-if="task.status === 'done' && copiedKey === `${task.id}-${algorithm}`"
                  class="copied-flag"
                  role="status"
                  aria-live="polite"
                >已复制</span>
              </dd>
            </div>
          </dl>
        </article>
      </section>
    </Transition>

    <!-- ── 拖拽遮罩 ── -->
    <div v-if="isDragging" class="drop-overlay" aria-hidden="true">
      <div class="drop-overlay__panel">松开以开始计算文件 Hash</div>
    </div>

    <!-- ── 大文件提醒弹窗 ── -->
    <div v-if="warningVisible" class="modal-layer" role="presentation">
      <section class="warning-dialog" role="dialog" aria-modal="true" aria-labelledby="large-file-title">
        <h2 id="large-file-title">计算可能需要较长时间</h2>
        <p>
          本次选择 {{ warningSummary.count }} 个文件，共
          {{ formatBytes(warningSummary.totalSize) }}。插件会使用流式读取，不会一次性加载整个文件。
        </p>
        <label class="checkbox-row">
          <input v-model="disableFutureWarnings" type="checkbox" />
          <span>不再提醒大文件计算</span>
        </label>
        <div class="dialog-actions">
          <button class="secondary-button" type="button" @click="cancelWarning">取消</button>
          <button class="primary-button" type="button" @click="continueAfterWarning">继续计算</button>
        </div>
      </section>
    </div>

    <!-- ── 完成 Toast ── -->
    <Transition name="completion-toast">
      <p
        v-if="completionToast"
        class="completion-toast"
        :class="`is-${completionToastTone}`"
        role="status"
        aria-live="polite"
      >{{ completionToast }}</p>
    </Transition>

    <!-- ── 设置抽屉 ── -->
    <Transition name="drawer">
      <div v-if="settingsOpen" class="drawer-overlay" role="presentation" @click.self="closeSettings">
        <aside class="settings-drawer" role="dialog" aria-modal="true" aria-label="设置">
          <header class="drawer-header">
            <h2>设置</h2>
            <button class="icon-button" type="button" aria-label="关闭设置" @click="closeSettings">✕</button>
          </header>

          <div class="settings-panel">
            <div class="settings-copy">
              <h3>大文件提醒</h3>
              <p>当单个文件或本次总大小超过阈值时，计算前先提醒。</p>
            </div>
            <label class="switch-row">
              <span>超过阈值时提醒我</span>
              <input v-model="settings.largeFileWarningEnabled" type="checkbox" role="switch" @change="saveSettings" />
            </label>
            <label class="threshold-row">
              <span>提醒阈值</span>
              <span class="number-field">
                <input v-model="thresholdInput" type="number" min="1" max="1024" step="1" @blur="updateThreshold" @change="updateThreshold" />
                <strong>GB</strong>
              </span>
            </label>

            <div class="settings-copy settings-copy--section">
              <h3>默认大小写</h3>
              <p>新计算结果首次显示时使用的大小写形式；不影响已显示的结果。</p>
            </div>
            <div class="switch-row" role="radiogroup" aria-label="默认大小写">
              <span>计算结果默认显示</span>
              <span class="segmented">
                <button type="button" class="segmented__option" :class="{ 'is-selected': settings.defaultCase === 'lowercase' }" role="radio" :aria-checked="settings.defaultCase === 'lowercase' ? 'true' : 'false'" @click="setDefaultCase('lowercase')">小写</button>
                <button type="button" class="segmented__option" :class="{ 'is-selected': settings.defaultCase === 'uppercase' }" role="radio" :aria-checked="settings.defaultCase === 'uppercase' ? 'true' : 'false'" @click="setDefaultCase('uppercase')">大写</button>
              </span>
            </div>

            <div class="settings-copy settings-copy--section">
              <h3>额外算法</h3>
              <p>默认只启用 MD5、SHA1、SHA256；勾选后会在下一次计算时生效。</p>
            </div>
            <label v-for="algorithm in EXTRA_HASH_ALGORITHMS" :key="algorithm" class="switch-row">
              <span>{{ HASH_ALGORITHM_LABELS[algorithm] }}</span>
              <input type="checkbox" role="switch" :checked="isExtraAlgorithmEnabled(algorithm)" @change="toggleExtraAlgorithm(algorithm, ($event.target as HTMLInputElement).checked)" />
            </label>
          </div>
        </aside>
      </div>
    </Transition>
  </main>
</template>
