<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { LogChunk, RunEvent } from '../types/api'
import type { RunRecord, RunStatus, RunTrigger } from '../types/domain'
import RunStatusTag from './RunStatusTag.vue'
import ImageViewer from './ImageViewer.vue'

interface ActiveLogEntry {
  timestamp: string
  type: 'stdout' | 'stderr'
  content: string
}

interface LogLine {
  time: string
  type: 'stdout' | 'stderr'
  content: string
  isImage?: boolean
  imageDataUrl?: string
  /** 图片开始标记已出现但结束标记尚未到达（仍在流式接收或日志截断）。 */
  isPending?: boolean
}

const props = defineProps<{
  requestConfirmation: (options: { title: string; message: string; type?: 'info' | 'warning' | 'danger'; confirmText?: string; cancelText?: string }) => Promise<boolean>
}>()
const emit = defineEmits<{ (event: 'feedback', type: 'success' | 'error', message: string): void }>()
const records = ref<RunRecord[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
/** Chunk size used when auto-loading to close an unclosed image marker; the backend caps single reads at 256 KiB. */
const autoImageChunkBytes = 256 * 1024
const search = ref('')
const status = ref<RunStatus | 'all'>('all')
const trigger = ref<RunTrigger | 'all'>('all')
const loading = ref(false)
const detailVisible = ref(false)
const selected = ref<RunRecord | null>(null)
/** Whether the open detail streams a live run ('live') or reads a persisted log ('persisted'). */
const detailMode = ref<'live' | 'persisted' | null>(null)
const log = ref<LogChunk | null>(null)
const logContent = ref('')
const logLoading = ref(false)
const retryingId = ref<string | null>(null)
const cleaning = ref(false)
/** 详情图片放大预览的 data URL；非空时挂载全屏 ImageViewer。 */
const previewSrc = ref<string | null>(null)
const triggerLabels = { manual: '手动', cron: '定时', retry: '重跑' } as const
const statusOptions = [
  { label: '全部状态', value: 'all' }, { label: '成功', value: 'success' }, { label: '失败', value: 'failed' },
  { label: '超时', value: 'timed_out' }, { label: '已停止', value: 'stopped' }, { label: '异常中断', value: 'interrupted' }
]
const triggerOptions = [{ label: '全部来源', value: 'all' }, { label: '手动', value: 'manual' }, { label: '定时', value: 'cron' }, { label: '重跑', value: 'retry' }]
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))

/** Run ids known to be active, kept reactive so cards and the detail drawer reflect live state. */
const activeRunIds = ref(new Set<string>())
/** Live log buffers for active runs, held in full so multi-chunk images can reassemble; released on finish unless a live detail holds them. */
const activeLogs = ref<Record<string, ActiveLogEntry[]>>({})
const stoppingRunIds = ref(new Set<string>())
/** Highest sequence seen per run, so stale events from a superseded snapshot are ignored. */
const activeRunSequences = new Map<string, number>()

/** Formats an ISO timestamp as `hh:mm:ss` local time for the live log meta column. */
function formatTime(timestamp: string): string {
  const date = new Date(timestamp)
  const pad = (input: number) => String(input).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** True when the open detail is streaming a live run rather than reading a persisted log. */
const isLiveDetail = computed(() => detailMode.value === 'live')

/**
 * 图片标记协议：脚本输出图片时用标记框住 base64 数据，避免按行分块后无法拼接。
 * 开始标记：@@SCRIPTY_IMAGE_START:<mime>@@（如 image/png）
 * 结束标记：@@SCRIPTY_IMAGE_END@@
 * 两标记之间的内容（允许换行）会被去掉空白后拼成 data URL。
 * 标记刻意以 @@ 包裹且带 SCRIPTY_ 前缀，降低与正常输出碰撞的概率。
 */
const IMAGE_START_RE = /@@SCRIPTY_IMAGE_START:([a-zA-Z]+\/[a-zA-Z0-9.+-]+)@@/
const IMAGE_END_MARKER = '@@SCRIPTY_IMAGE_END@@'

/**
 * 把扁平日志条目里的图片标记折叠成单条图片条目。
 * 扫描顺序敏感：收集到开始标记后，跨条目累积 base64 直到遇到结束标记，
 * 中间纯 base64 的条目被吸收、不再单独展示。开始标记所在行的时间戳作为图片时间戳。
 * 未闭合的开始标记保留为 isPending 占位条目（流式接收中或日志截断）。
 */
function parseImageMarkers(entries: LogLine[]): LogLine[] {
  const result: LogLine[] = []
  let collecting = false
  let mime = ''
  let buffer = ''
  let imgTime = ''
  let imgType: 'stdout' | 'stderr' = 'stdout'

  for (const entry of entries) {
    let cursor = entry.content
    while (cursor) {
      if (!collecting) {
        const start = cursor.match(IMAGE_START_RE)
        if (!start) {
          result.push({ ...entry, content: cursor })
          break
        }
        if (start.index! > 0) {
          const before = cursor.slice(0, start.index)
          if (before.trim()) result.push({ ...entry, content: before })
        }
        collecting = true
        mime = start[1]
        imgTime = entry.time
        imgType = entry.type
        cursor = cursor.slice(start.index! + start[0].length)
      } else {
        const endIdx = cursor.indexOf(IMAGE_END_MARKER)
        if (endIdx < 0) {
          buffer += cursor
          break
        }
        buffer += cursor.slice(0, endIdx)
        result.push({
          time: imgTime,
          type: imgType,
          content: '',
          isImage: true,
          imageDataUrl: `data:${mime};base64,${buffer.replace(/\s+/g, '')}`
        })
        collecting = false
        mime = ''
        buffer = ''
        cursor = cursor.slice(endIdx + IMAGE_END_MARKER.length)
      }
    }
  }

  if (collecting) {
    result.push({ time: imgTime, type: imgType, content: '', isImage: true, imageDataUrl: '', isPending: true })
  }
  return result
}

/**
 * Splits the persisted log buffer into entries.
 * 图片标记可能单独成行（无时间戳前缀），需要作为独立条目参与解析；
 * 否则 parseImageMarkers 会因为 START/END 被合并到前后条目尾巴而无法闭合。
 * 不在此阶段判断图片，统一交给 parseImageMarkers 处理标记协议。
 */
const logEntries = computed<LogLine[]>(() => {
  const text = logContent.value
  if (!text) return []
  const lines = text.split('\n')
  const result: LogLine[] = []
  const prefix = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) \[(stdout|stderr)\] /

  let currentTime = '00:00:00'
  let currentType: 'stdout' | 'stderr' = 'stdout'

  for (const line of lines) {
    const match = line.match(prefix)
    if (match) {
      currentTime = match[2]
      currentType = match[3] as 'stdout' | 'stderr'
      const content = line.slice(match[0].length)
      result.push({
        time: currentTime,
        type: currentType,
        content
      })
    } else if (line.trim()) {
      // 无时间戳前缀的非空行（如图片标记），继承上一条的时间和类型
      result.push({
        time: currentTime,
        type: currentType,
        content: line
      })
    }
  }
  return result
})

/** Live log entries in emit order; image markers are parsed forward and displayed in chronological order. */
const liveLogEntries = computed<LogLine[]>(() => {
  if (detailMode.value !== 'live' || !selected.value) return []
  const entries = activeLogs.value[selected.value.id] ?? []
  return entries.map(entry => ({
    time: formatTime(entry.timestamp),
    type: entry.type,
    content: entry.content
  }))
})

/**
 * Entries rendered in the detail log grid, switching between live and persisted sources.
 * 图片标记解析必须在原始 emit 顺序上进行（前向状态机：START → base64 → END）；
 * 无论运行中还是运行完成，都按时间顺序从上到下输出，不再反转。
 */
const visibleLogEntries = computed<LogLine[]>(() => {
  const input = detailMode.value === 'live' ? liveLogEntries.value : logEntries.value
  return parseImageMarkers(input)
})

let historyRequestSequence = 0
let unsubscribeRuns: (() => void) | null = null
let mounted = false

/** Loads one filtered page and allows only the newest request to replace the visible history snapshot. */
async function loadHistory() {
  const requestSequence = ++historyRequestSequence
  loading.value = true
  const activeStatus = status.value && status.value !== 'all' ? status.value : undefined
  const activeTrigger = trigger.value && trigger.value !== 'all' ? trigger.value : undefined
  const result = await window.scripty?.history?.list({ page: page.value, pageSize, search: search.value || undefined, status: activeStatus, trigger: activeTrigger })
  if (!mounted || requestSequence !== historyRequestSequence) return
  loading.value = false
  if (result?.ok === true) {
    records.value = result.data.items
    total.value = result.data.total
  } else if (result?.ok === false) emit('feedback', 'error', result.error.message)
}

/** Opens one run detail from its history card; active runs stream live logs, terminal runs read persisted chunks. */
async function openDetail(record: RunRecord) {
  const detail = await window.scripty.history.get(record.id)
  if (detail.ok === false) return emit('feedback', 'error', detail.error.message)
  selected.value = detail.data
  detailMode.value = activeRunIds.value.has(record.id) ? 'live' : 'persisted'
  detailVisible.value = true
  logContent.value = ''
  log.value = null
  if (detailMode.value === 'persisted') await loadNextLogChunk()
}

/**
 * Appends one persisted log chunk without truncation, so a base64 image split across many chunks
 * can reassemble inside `logContent` and close its END marker.
 * `length` defaults to 64 KiB for manual paging; the image-auto-load watcher passes a larger block.
 * The template binds this directly to `@click`, which passes the DOM event as the first argument,
 * so a non-number `length` is coerced back to the default rather than sent to the backend.
 */
async function loadNextLogChunk(length: number = 64 * 1024) {
  if (!selected.value || logLoading.value || log.value?.end) return
  const readLength = typeof length === 'number' ? length : 64 * 1024
  logLoading.value = true
  const chunk = await window.scripty.history.readLog(selected.value.id, { offset: log.value?.nextOffset ?? 0, length: readLength })
  logLoading.value = false
  if (chunk.ok === false) return emit('feedback', 'error', chunk.error.message)
  log.value = chunk.data
  logContent.value += chunk.data.content
}

/** Closes the detail and releases any live buffer held open for a finished run. */
function closeDetail() {
  if (selected.value && detailMode.value === 'live' && !activeRunIds.value.has(selected.value.id)) {
    const nextLogs = { ...activeLogs.value }
    delete nextLogs[selected.value.id]
    activeLogs.value = nextLogs
  }
  detailVisible.value = false
  selected.value = null
  detailMode.value = null
  log.value = null
  logContent.value = ''
  previewSrc.value = null
}

/** Opens the fullscreen zoom/pan viewer for one log image entry. */
function openImagePreview(entry: LogLine) {
  if (entry.imageDataUrl) previewSrc.value = entry.imageDataUrl
}

/** Starts a failed historical task through its current persisted configuration and refreshes the page afterward. */
async function retry(record: RunRecord) {
  if (retryingId.value) return
  retryingId.value = record.id
  const result = await window.scripty.history.retry(record.id)
  retryingId.value = null
  if (result.ok === false) return emit('feedback', 'error', result.error.message)
  emit('feedback', 'success', `已重跑“${record.taskNameSnapshot}”`)
  await loadHistory()
}

/** Opens a danger confirmation before deleting every persisted run record and its controlled log file. */
async function clearAllHistory() {
  if (cleaning.value) return
  const accepted = await props.requestConfirmation({
    title: '确认清空运行历史',
    message: '将清空所有运行历史记录及其日志，且无法恢复。确认继续？',
    type: 'danger',
    confirmText: '清空全部',
    cancelText: '取消'
  })
  if (!accepted) return

  cleaning.value = true
  const result = await window.scripty.history.clear()
  cleaning.value = false
  if (result.ok === false) return emit('feedback', 'error', result.error.message)
  emit('feedback', 'success', `已清空 ${result.data.recordsRemoved} 条记录和 ${result.data.logFilesRemoved} 个日志文件`)
  page.value = 1
  await loadHistory()
}

/** Moves to a valid history page and reloads its summaries. */
function movePage(nextPage: number) { page.value = Math.min(pageCount.value, Math.max(1, nextPage)); loadHistory() }

/** Formats an ISO timestamp as local `yyyy-mm-dd hh:mm:ss`, leaving unparseable values untouched. */
function formatDateTime(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (input: number) => String(input).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** Formats millisecond duration into a concise user-facing value. */
function formatDuration(durationMs: number | null) {
  if (durationMs === null) return '运行中'
  if (durationMs < 1000) return `${durationMs} ms`
  return `${(durationMs / 1000).toFixed(1)} s`
}

/** Adds a run id to the active set via reassignment so Vue re-renders dependent bindings. */
function markActive(runId: string) {
  if (activeRunIds.value.has(runId)) return
  activeRunIds.value = new Set(activeRunIds.value).add(runId)
}

/** Removes a run id from the active set via reassignment so Vue re-renders dependent bindings. */
function markInactive(runId: string) {
  if (!activeRunIds.value.has(runId)) return
  const next = new Set(activeRunIds.value)
  next.delete(runId)
  activeRunIds.value = next
}

/** Stops one active process tree and keeps the button locked until preload confirms a terminal record. */
async function stopActiveRun(runId: string) {
  const api = window.scripty?.runs
  if (!api || stoppingRunIds.value.has(runId)) return
  stoppingRunIds.value = new Set(stoppingRunIds.value).add(runId)
  await api.stop(runId)
  const next = new Set(stoppingRunIds.value)
  next.delete(runId)
  stoppingRunIds.value = next
}

/** Applies ordered run events: tracks active runs, streams live logs, and refreshes history on completion. */
function handleRunEvent(event: RunEvent) {
  const lastSequence = activeRunSequences.get(event.runId) ?? 0
  if (event.sequence <= lastSequence) return
  activeRunSequences.set(event.runId, event.sequence)
  if (event.type === 'finished') {
    markInactive(event.runId)
    // keep the live buffer if the open detail is still streaming this run, so the final output stays visible
    const viewingLive = selected.value?.id === event.runId && detailMode.value === 'live'
    if (!viewingLive) {
      const nextLogs = { ...activeLogs.value }
      delete nextLogs[event.runId]
      activeLogs.value = nextLogs
    }
    if (selected.value?.id === event.runId) selected.value = event.record
    void loadHistory()
  } else if (event.type === 'status' && event.record) {
    markActive(event.runId)
  } else if (event.type === 'stdout' || event.type === 'stderr') {
    const current = activeLogs.value[event.runId] ?? []
    const appended = [...current, { timestamp: new Date().toISOString(), type: event.type, content: event.chunk }]
    activeLogs.value = { ...activeLogs.value, [event.runId]: appended }
  }
}

/** Loads active runs so cards and the detail drawer know which runs stream live logs. */
async function loadActiveRuns() {
  const api = window.scripty?.runs
  if (!api) return
  const result = await api.getActive()
  if (!mounted || result.ok === false) return
  const nextActive = new Set(activeRunIds.value)
  for (const snapshot of result.data) {
    const lastSequence = activeRunSequences.get(snapshot.id) ?? 0
    if (snapshot.sequence < lastSequence) continue
    nextActive.add(snapshot.id)
    activeRunSequences.set(snapshot.id, Math.max(lastSequence, snapshot.sequence))
  }
  activeRunIds.value = nextActive
}

/** Subscribes before any request so fast run events cannot be overwritten by a stale snapshot response. */
async function initializeHistory() {
  mounted = true
  unsubscribeRuns = window.scripty?.runs?.subscribe(handleRunEvent) ?? null
  void loadHistory()
  await loadActiveRuns()
}

/** Invalidates pending requests and releases the run-event subscription when the view leaves the DOM. */
function disposeHistory() {
  mounted = false
  historyRequestSequence += 1
  unsubscribeRuns?.()
  unsubscribeRuns = null
}

watch([search, status, trigger], () => { page.value = 1; void loadHistory() })
/**
 * 持久化日志按块读取，单张截图的 base64 通常远超一块；开始标记落在当前块而结束标记还在后续块时，
 * parseImageMarkers 会留下 isPending 占位条目（显示"图片数据接收中…"）。只要还没读到文件末尾就自动
 * 续读更大的块，直到图片闭合或日志读完，兑现 README 承诺的"跨日志块自动重组"。运行中的实时流不走此分支。
 */
watch(visibleLogEntries, entries => {
  if (detailMode.value !== 'persisted') return
  if (!entries.some(entry => entry.isPending)) return
  if (!log.value || log.value.end || logLoading.value) return
  void loadNextLogChunk(autoImageChunkBytes)
})
onMounted(initializeHistory)
onBeforeUnmount(disposeHistory)
</script>

<template>
  <section class="history-view" aria-labelledby="history-heading">
    <div class="view-toolbar">
      <div class="section-heading"><div><h2 id="history-heading">运行历史</h2></div><div class="section-heading__actions"><ZButton type="danger" size="small" :loading="cleaning" :disabled="total === 0" @click="clearAllHistory">全部清空</ZButton></div></div>
      <div class="history-filters">
        <ZInput v-model="search" placeholder="搜索任务、脚本" />
        <ZSelect v-model="status" :options="statusOptions" />
        <ZSelect v-model="trigger" :options="triggerOptions" />
      </div>
    </div>
    <p v-if="loading" class="task-message" role="status">正在加载运行历史…</p>
    <div v-else-if="records.length === 0" class="empty-state"><div class="empty-state__mark">H</div><h3>暂无运行记录</h3><p>任务完成或失败后会保留摘要。</p></div>
    <ul v-else class="history-list">
      <li
        v-for="record in records"
        :key="record.id"
        class="history-row"
        role="button"
        tabindex="0"
        :aria-label="`查看${record.taskNameSnapshot}的运行详情`"
        @click="openDetail(record)"
        @keydown.enter="openDetail(record)"
        @keydown.space.prevent="openDetail(record)"
      >
        <div class="history-row__summary">
          <strong class="history-row__name">{{ record.taskNameSnapshot }}</strong>
          <RunStatusTag :status="record.status" />
          <span class="history-row__tag">{{ triggerLabels[record.trigger] }}</span>
          <span class="history-row__tag">{{ formatDuration(record.durationMs) }}</span>
        </div>
        <time class="history-row__time" :datetime="record.startedAt">{{ formatDateTime(record.startedAt) }}</time>
        <p v-if="record.errorSummary" class="history-error">{{ record.errorSummary }}</p>
        <div v-if="activeRunIds.has(record.id) || record.status === 'failed'" class="history-row__actions" @click.stop @keydown.stop>
          <ZButton v-if="activeRunIds.has(record.id)" type="danger" size="small" :loading="stoppingRunIds.has(record.id)" @click="stopActiveRun(record.id)">停止</ZButton>
          <ZButton v-if="record.status === 'failed'" size="small" type="primary" :loading="retryingId === record.id" @click="retry(record)">快速重跑</ZButton>
        </div>
      </li>
    </ul>
    <div class="history-pagination">
      <span class="history-pagination__total">共 {{ total }} 条</span>
      <div v-if="total > pageSize" class="history-pagination__controls">
        <ZButton size="small" :disabled="page <= 1" @click="movePage(page - 1)">上一页</ZButton>
        <span>{{ page }} / {{ pageCount }}</span>
        <ZButton size="small" :disabled="page >= pageCount" @click="movePage(page + 1)">下一页</ZButton>
      </div>
    </div>

    <ZDrawer v-model:show="detailVisible" placement="right" width="560" trap-focus auto-focus @update:show="(show: boolean) => { if (!show) closeDetail() }">
      <ZDrawerContent title="运行详情" closable>
        <div v-if="selected" class="history-detail">
          <div class="backup-preview__heading"><div><h3>{{ selected.taskNameSnapshot }}</h3><p>{{ selected.scriptNameSnapshot }}</p></div><RunStatusTag :status="selected.status" /></div>
          <dl class="backup-summary"><div><dt>开始</dt><dd>{{ formatDateTime(selected.startedAt) }}</dd></div><div><dt>结束</dt><dd>{{ formatDateTime(selected.finishedAt) }}</dd></div><div><dt>触发</dt><dd>{{ triggerLabels[selected.trigger] }}</dd></div><div><dt>耗时</dt><dd>{{ formatDuration(selected.durationMs) }}</dd></div><div><dt>退出码</dt><dd>{{ selected.exitCode ?? '—' }}</dd></div></dl>
          <p v-if="selected.errorSummary" class="history-error">{{ selected.errorSummary }}</p>
          <section>
            <div class="history-log__heading">
              <h4>运行日志</h4>
              <ZButton v-if="!isLiveDetail && log && !log.end" size="small" :loading="logLoading" @click="loadNextLogChunk">继续读取 64 KiB</ZButton>
            </div>
            <div v-if="visibleLogEntries.length" class="history-log history-log--grid">
              <template v-for="(entry, index) in visibleLogEntries" :key="index">
                <span class="history-log__meta" :class="`history-log__meta--${entry.type}`">[{{ entry.time }}] [{{ entry.type }}]</span>
                <div v-if="entry.isImage" class="history-log__content history-log__content--image">
                  <img v-if="entry.imageDataUrl" :src="entry.imageDataUrl" alt="运行截图" title="点击放大" class="history-log__image" @click="openImagePreview(entry)" />
                  <span v-else class="history-log__image-pending">图片数据接收中…</span>
                </div>
                <span v-else class="history-log__content">{{ entry.content }}</span>
              </template>
            </div>
            <pre v-else class="history-log">{{ isLiveDetail ? '等待输出…' : (logContent || '暂无日志') }}</pre>
          </section>
        </div>
      </ZDrawerContent>
    </ZDrawer>

    <ImageViewer v-if="previewSrc" :src="previewSrc" @close="previewSrc = null" />
  </section>
</template>

<style scoped lang="scss">
.history-view {
  padding-top: 0;
}

.history-filters {
  display: grid;
  grid-template-columns: auto repeat(2, 150px);
  gap: 12px;
  margin-bottom: 20px;
}

.history-row__actions,
.history-pagination,
.history-pagination__controls {
  display: flex;
  align-items: center;
  gap: 10px;
}

.history-row__actions {
  justify-content: flex-start;
  grid-column: 1 / -1;
}

/* zt-button--primary is a class on the ztools-ui button internals; reach it via :deep. */
.history-row__actions :deep(.zt-button--primary) {
  color: #fff !important;
}

.history-pagination {
  justify-content: space-between;
  margin-top: 18px;
}

.history-pagination__total {
  color: var(--text-secondary);
  font-size: 13px;
}

.history-detail {
  display: grid;
  gap: 20px;
  padding: 20px;
}

.history-detail h3,
.history-detail h4 {
  margin: 0;
}

.history-log__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.history-log {
  max-height: 420px;
  overflow: auto;
  padding: 14px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--code-bg, var(--card-bg));
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: 12px/1.6 "SFMono-Regular", Consolas, monospace;
}

.history-log--grid {
  display: grid;
  grid-template-columns: max-content 1fr;
  column-gap: 14px;
  row-gap: 2px;
  align-items: baseline;
  white-space: normal;
}

.history-log__meta {
  color: var(--text-secondary);
  white-space: nowrap;
  user-select: none;
}

.history-log__meta--stderr {
  color: var(--error-color);
}

.history-log__content {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.history-log__content--image {
  display: block;
  margin: 4px 0;
}

.history-log__image {
  max-width: 100%;
  height: auto;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  display: block;
  cursor: zoom-in;
  transition: filter 0.15s ease;
}

.history-log__image:hover {
  filter: brightness(0.92);
}

.history-log__image-pending {
  display: inline-block;
  padding: 6px 10px;
  border: 1px dashed var(--border-color);
  border-radius: 6px;
  color: var(--text-secondary);
  font-size: 12px;
}

.history-list {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
  height: 100%;
  overflow: auto;
  margin-bottom: 20px;
  /* top/bottom padding absorbs the focus glow on the row action buttons of the
     first/last row, which `overflow: auto` would otherwise clip. */
  padding-top: 8px;
  padding-bottom: 8px;
  padding-right: 10px;
}

.history-row {
  max-height: 150px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  padding: 16px 18px;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: var(--card-bg);
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
}

.history-row:hover {
  border-color: color-mix(in srgb, var(--primary-color) 40%, var(--border-color));
  background: var(--hover-bg);
}

.history-row:focus-visible {
  outline: none;
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px var(--primary-light-bg);
}

.history-row__summary {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.history-row__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-row__tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: var(--card-bg);
  font-size: 12px;
  white-space: nowrap;
}

.history-row__time {
  justify-self: end;
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
}

.history-error {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--error-color);
  font-size: 13px;
  width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
