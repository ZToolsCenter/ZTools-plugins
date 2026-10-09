<script setup lang="ts">
import { Check, Copy, Replace, Settings as SettingsIcon } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const emit = defineEmits<{
  openSettings: []
}>()

interface FileDescriptor {
  isDirectory: boolean
  isFile: boolean
  name: string
  path: string
}

interface DropResult {
  descriptors: FileDescriptor[]
  fallbackImages: string[]
}

interface DropEntry {
  isDirectory?: boolean
  isFile?: boolean
  name: string
}

type HostApi = {
  [key: string]: any
}

const MAX_HISTORY = 8
const batches = ref<ImageBatch[]>([])
const activeIndex = ref(-1)
const dropVisible = ref(false)
const importing = ref(false)
const failedThumbnails = ref(new Set<string>())
const copiedEntries = ref(new Set<string>())
const replacedEntries = ref(new Set<string>())

const activeBatch = computed(() => {
  return activeIndex.value >= 0 && activeIndex.value < batches.value.length
    ? batches.value[activeIndex.value]
    : null
})

const replaceCount = computed(() => {
  const batch = activeBatch.value
  return batch?.entries.filter((entry) => {
    return !entry.error && entry.resultPath && entry.resultBytes !== null && entry.resultBytes < entry.inputBytes
  }).length || 0
})

const savedSummary = computed(() => {
  const batch = activeBatch.value
  if (!batch) return { bytes: 0, percent: '0.0' }
  const total = batch.entries.reduce((sum, entry) => {
    return entry.error || entry.resultBytes === null
      ? sum
      : sum + Math.max(0, entry.inputBytes - entry.resultBytes)
  }, 0)
  const original = batch.entries.reduce((sum, entry) => {
    return entry.error ? sum : sum + (entry.inputBytes || 0)
  }, 0)
  return {
    bytes: total,
    percent: original > 0 ? (100 * total / original).toFixed(1) : '0.0'
  }
})

/** 获取 zTools 宿主对象，浏览器预览模式下允许不存在该对象。 */
function getZ(): HostApi {
  try {
    return (window as Window & { ztools?: HostApi }).ztools || {}
  } catch {
    return {}
  }
}

/** 将时间转换为紧凑展示文本。 */
function formatTime(value: number): string {
  const created = new Date(value || Date.now())
  const now = new Date()
  const seconds = Math.max(0, (now.getTime() - created.getTime()) / 1000)
  if (seconds < 60) return '此刻'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  if (created.toDateString() === now.toDateString()) {
    return `${String(created.getHours()).padStart(2, '0')}:${String(created.getMinutes()).padStart(2, '0')}`
  }
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)} 天前`
  return `${created.getMonth() + 1}/${created.getDate()}`
}

/** 构造历史批次 tab 标题。 */
function tabTitle(batch: ImageBatch): string {
  if (batch.phase === 'scanning') return `扫描中 · ${batch.scan?.found || 0}张`
  return `${formatTime(batch.createdAt)} · ${batch.entries.length}张`
}

/** 将本地路径转换为图片 URL。 */
function localUrl(filePath: string): string {
  let normalized = String(filePath).replace(/\\/g, '/')
  if (!normalized.startsWith('/')) normalized = `/${normalized}`
  return `file://${encodeURI(normalized)}`
}

/** 判断输入项是否为受支持的图片。 */
function isImage(entry: ImageEntry): boolean {
  return /\.(jpg|jpeg|png|gif|svg)$/i.test(entry.filename || '')
}

/** 获取一项应该展示的缩略图路径。 */
function thumbnailPath(entry: ImageEntry): string | null {
  if (!isImage(entry)) return null
  const target = entry.resultPath && entry.resultBytes !== null && entry.resultBytes < entry.inputBytes
    ? entry.resultPath
    : entry.inputPath
  return target || null
}

/** 格式化文件大小，运行时不可用时保留空文本。 */
function formatBytes(value: number): string {
  const runtime = window.imgCompRuntime
  return runtime?.formatBytes(value) || ''
}

/** 读取历史记录并按时间从旧到新排列。 */
function historyRecords(): unknown[] {
  try {
    const runtime = window.imgCompRuntime
    const records = runtime?.history?.()
    return Array.isArray(records)
      ? records.slice().sort((left: any, right: any) => (left?.createdAt || 0) - (right?.createdAt || 0))
      : []
  } catch {
    return []
  }
}

/** 将一个已完成批次写入历史记录。 */
function remember(batch: ImageBatch): void {
  const runtime = window.imgCompRuntime
  if (!runtime?.writeHistory || !runtime.toHistory) return
  const records = historyRecords().filter((item: any) => item?.id !== batch.id)
  records.push(runtime.toHistory(batch))
  runtime.writeHistory(records.slice(-MAX_HISTORY))
}

/** 从历史记录创建可展示批次。 */
function restore(record: unknown): ImageBatch {
  return window.imgCompRuntime!.fromHistory(record)
}

/** 启动时载入已有历史批次。 */
function loadSavedBatches(): void {
  for (const record of historyRecords()) {
    const batch = restore(record)
    if (batch.entries.length > 0) batches.value.push(batch)
  }
  if (batches.value.length > 0) activeIndex.value = batches.value.length - 1
}

/** 读取文件的 Data URI。 */
function readDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

/** 取得本次拖拽中的文件描述。 */
async function inspectDrop(transfer: DataTransfer): Promise<DropResult> {
  const descriptors: FileDescriptor[] = []
  const fallbackImages: string[] = []
  const knownPaths = new Set<string>()
  const items = transfer.items ? Array.from(transfer.items) : []
  const addDescriptor = (descriptor: FileDescriptor): void => {
    if (!descriptor.path || knownPaths.has(descriptor.path)) return
    knownPaths.add(descriptor.path)
    descriptors.push(descriptor)
  }

  for (const item of items) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile ? item.getAsFile() : null
    const dropEntry = (item as DataTransferItem & {
      webkitGetAsEntry?: () => DropEntry & { isDirectory?: boolean; isFile?: boolean }
    }).webkitGetAsEntry?.()
    if (!file) continue

    let filePath = ''
    try {
      filePath = getZ().getPathForFile ? getZ().getPathForFile(file) : ''
    } catch {
      filePath = ''
    }
    if (dropEntry?.isDirectory) {
      addDescriptor({ isDirectory: true, isFile: false, name: dropEntry.name, path: filePath })
    } else if (filePath) {
      addDescriptor({ isDirectory: false, isFile: true, name: file.name, path: filePath })
    } else if (item.type?.startsWith('image/')) {
      fallbackImages.push(await readDataUri(file))
    }
  }

  if (items.length === 0 && transfer.files?.length) {
    for (const file of Array.from(transfer.files)) {
      let filePath = ''
      try {
        filePath = getZ().getPathForFile ? getZ().getPathForFile(file) : ''
      } catch {
        filePath = ''
      }
      if (filePath) {
        addDescriptor({ isDirectory: false, isFile: true, name: file.name, path: filePath })
      } else if (file.type?.startsWith('image/')) {
        fallbackImages.push(await readDataUri(file))
      }
    }
  }
  return { descriptors, fallbackImages }
}

/** 从当前文件管理器窗口创建压缩批次。 */
async function startBatchFromCurrentFolder(): Promise<void> {
  const host = getZ()
  if (typeof host.readCurrentFolderPath !== 'function') {
    host.showNotification?.('当前 ZTools 版本不支持读取文件管理器路径')
    return
  }

  let folderPath = ''
  try {
    folderPath = await host.readCurrentFolderPath()
  } catch {
    return
  }
  if (!folderPath) return

  const folderName = folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath
  await startBatch('files', [{ isDirectory: true, isFile: false, name: folderName, path: folderPath }])
}

/** 创建并执行一个压缩批次。 */
async function startBatch(kind: string, payload: unknown, extraImages: string[] = []): Promise<void> {
  const runtime = window.imgCompRuntime
  if (!runtime) return

  const refresh = (): void => {
    batches.value = [...batches.value]
  }
  const batch = await runtime.create({ kind, payload }, refresh)
  if (extraImages.length > 0) await runtime.addDataUris(batch, extraImages)

  batches.value.push(batch)
  activeIndex.value = batches.value.length - 1
  void runtime.execute(batch, refresh).then((completed) => {
    batches.value = [...batches.value]
    if (completed.phase === 'complete' && !completed.cancelled) remember(completed)
  })
}

/** 处理插件进入事件。 */
async function handlePluginEnter(action: { type?: string; payload?: unknown }): Promise<void> {
  if (action.type === 'files' && Array.isArray(action.payload) && action.payload.length > 0) {
    await startBatch('files', action.payload)
  } else if (action.type === 'img' && action.payload) {
    await startBatch('clipboard', Array.isArray(action.payload) ? action.payload : [action.payload])
  } else if (action.type === 'window') {
    await startBatchFromCurrentFolder()
  }
}

/** 从剪贴板导入图片并创建批次。 */
async function handlePaste(event: ClipboardEvent): Promise<void> {
  if (!event.clipboardData) return
  const images: string[] = []
  for (const item of Array.from(event.clipboardData.items || [])) {
    if (!item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) images.push(await readDataUri(file))
  }
  if (images.length > 0) {
    event.preventDefault()
    await startBatch('clipboard', images)
  }
}

/** 处理拖拽导入。 */
async function handleDrop(event: DragEvent): Promise<void> {
  event.preventDefault()
  event.stopPropagation()
  dropVisible.value = false
  if (importing.value || !event.dataTransfer) return

  importing.value = true
  try {
    const drop = await inspectDrop(event.dataTransfer)
    if (drop.descriptors.length > 0) {
      await startBatch('files', drop.descriptors, drop.fallbackImages)
    } else if (drop.fallbackImages.length > 0) {
      await startBatch('clipboard', drop.fallbackImages)
    }
  } finally {
    importing.value = false
  }
}

/** 在成功操作后按窗口形态决定是否关闭插件窗口。 */
function dismissMainWindow(): void {
  const host = getZ()
  if (typeof host.getWindowType === 'function' && host.getWindowType() === 'detach') return
  host.hideMainWindow?.()
}

/** 关闭指定历史批次。 */
function closeBatch(index: number): void {
  const batch = batches.value[index]
  const runtime = window.imgCompRuntime
  if (batch && runtime) {
    if (batch.phase === 'scanning' || batch.phase === 'running' || batch.phase === 'pending') runtime.cancel(batch)
    runtime.removeHistory?.(batch.historyId || batch.id)
  }
  batches.value.splice(index, 1)
  if (batches.value.length === 0) activeIndex.value = -1
  else if (activeIndex.value >= batches.value.length) activeIndex.value = batches.value.length - 1
}

/** 统计批次中可复制的结果路径。 */
function copyTargets(batch: ImageBatch): string[] {
  return [...new Set(batch.entries
    .filter((entry) => !entry.error)
    .map((entry) => entry.resultPath || entry.inputPath)
    .filter((value): value is string => Boolean(value)))]
}

/** 取消扫描并关闭当前扫描标签页。 */
function cancelScan(batch: ImageBatch): void {
  window.imgCompRuntime?.cancel(batch)
  const index = batches.value.indexOf(batch)
  if (index >= 0) closeBatch(index)
}

/** 判断单项是否有可替换的压缩结果。 */
function canReplace(entry: ImageEntry): boolean {
  const batch = activeBatch.value
  return batch?.phase === 'complete' && (replacedEntries.value.has(entry.id) ||
    (!entry.error && !!entry.resultPath && entry.resultPath !== entry.inputPath &&
      entry.resultBytes !== null && entry.resultBytes < entry.inputBytes))
}

/** 复制单张图片并记录完成状态。 */
function copyOne(entry: ImageEntry): void {
  const target = entry.resultPath || entry.inputPath
  if (!target) return
  if (window.imgCompRuntime?.copyOne(target)) {
    copiedEntries.value = new Set(copiedEntries.value).add(entry.id)
  }
}

/** 替换单张图片并记录完成状态。 */
async function replaceOne(batch: ImageBatch, entry: ImageEntry): Promise<void> {
  const success = await window.imgCompRuntime?.replaceOne(batch, entry)
  if (success) replacedEntries.value = new Set(replacedEntries.value).add(entry.id)
}

/** 复制整个批次的图片并在主窗口中隐藏插件。 */
async function copyAll(batch: ImageBatch): Promise<void> {
  const targets = copyTargets(batch)
  const result = await window.imgCompRuntime?.copyMany(targets)
  const success = typeof result === 'object' ? result.success : result
  const count = typeof result === 'object' && Number.isInteger(result.count) ? result.count : targets.length
  getZ().showNotification?.(success
    ? `已复制 ${count} 张图片到剪贴板`
    : `批量复制失败，应复制 ${targets.length} 张图片`)
  if (success) {
    for (const entry of batch.entries) {
      if (!entry.error) copiedEntries.value = new Set(copiedEntries.value).add(entry.id)
    }
    dismissMainWindow()
  }
}

/** 取消当前批次。 */
function cancelBatch(batch: ImageBatch): void {
  window.imgCompRuntime?.cancel(batch)
}

/** 覆盖原图并在成功后隐藏主窗口。 */
async function replaceInputs(batch: ImageBatch, count: number): Promise<void> {
  const replaceableIds = batch.entries.filter(canReplace).map((entry) => entry.id)
  const success = await window.imgCompRuntime?.replaceInputs(batch)
  getZ().showNotification?.(success ? `已覆盖 ${count} 张` : '覆盖失败')
  if (success) {
    for (const entryId of replaceableIds) {
      replacedEntries.value = new Set(replacedEntries.value).add(entryId)
    }
    dismissMainWindow()
  }
}

/** 记录缩略图加载失败，显示占位图标。 */
function markThumbnailFailed(path: string): void {
  failedThumbnails.value = new Set(failedThumbnails.value).add(path)
}

/** 注册拖拽、粘贴和插件进入事件。 */
function bindEvents(): void {
  document.body.addEventListener('dragover', handleDragOver)
  document.body.addEventListener('drop', handleDrop)
  document.body.addEventListener('dragenter', handleDragEnter)
  document.body.addEventListener('dragleave', handleDragLeave)
  document.addEventListener('paste', handlePaste)
  getZ().onPluginEnter?.(handlePluginEnter)
}

/** 阻止拖拽文件被浏览器直接打开。 */
function handleDragOver(event: DragEvent): void {
  event.preventDefault()
  event.stopPropagation()
}

/** 显示拖拽导入提示。 */
function handleDragEnter(event: DragEvent): void {
  event.preventDefault()
  dropVisible.value = true
}

/** 在拖拽离开窗口时移除提示。 */
function handleDragLeave(event: DragEvent): void {
  if (!event.relatedTarget) dropVisible.value = false
}

/** 移除页面事件监听。 */
function unbindEvents(): void {
  document.body.removeEventListener('dragover', handleDragOver)
  document.body.removeEventListener('drop', handleDrop)
  document.body.removeEventListener('dragenter', handleDragEnter)
  document.body.removeEventListener('dragleave', handleDragLeave)
  document.removeEventListener('paste', handlePaste)
}

onMounted(() => {
  if (!window.imgCompRuntime) return
  loadSavedBatches()
  bindEvents()
})

onBeforeUnmount(unbindEvents)
</script>

<template>
  <div class="image-compressor">
    <div v-if="batches.length > 0" class="tabs">
      <div
        v-for="(batch, index) in batches"
        :key="batch.id"
        class="tab"
        :class="{ active: index === activeIndex }"
        @click="activeIndex = index"
      >
        <span class="text" :title="tabTitle(batch)">{{ tabTitle(batch) }}</span>
        <button class="x" type="button" title="关闭" @click.stop="closeBatch(index)">×</button>
      </div>
    </div>

    <div v-if="activeBatch" class="batch-view">
      <div class="progress">
        <div :style="{ width: `${activeBatch.progress.percent || 0}%` }"></div>
      </div>

      <main v-if="activeBatch.phase === 'scanning'" class="scan-main">
        <div class="scan-spinner" aria-hidden="true"></div>
        <strong>正在扫描图片文件</strong>
        <div class="scan-progress">
          已扫描出 {{ activeBatch.scan?.found || 0 }} 个图片文件，已检查 {{ activeBatch.scan?.scanned || 0 }} 个条目
        </div>
        <button class="btn danger" type="button" @click="cancelScan(activeBatch)">取消扫描</button>
      </main>

      <main v-else class="main">
        <div v-if="activeBatch.error" class="empty">
          <div class="big">⚠</div>
          <div>{{ activeBatch.error }}</div>
        </div>
        <div v-else-if="activeBatch.entries.length === 0" class="empty">
          <div class="big">🖼</div>
          <div>未找到支持的图片</div>
        </div>
        <div v-else class="list">
          <div
            v-for="entry in activeBatch.entries"
            :key="entry.id"
            class="row"
            :class="{ sub: entry.relativeName && entry.relativeName !== entry.filename }"
          >
            <div class="thumb">
              <template v-if="thumbnailPath(entry)">
                <img
                  v-if="!failedThumbnails.has(thumbnailPath(entry)!)"
                  :src="`${localUrl(thumbnailPath(entry)!)}${entry.resultBytes ? `?v=${entry.resultBytes}` : ''}`"
                  alt=""
                  loading="lazy"
                  @error="markThumbnailFailed(thumbnailPath(entry)!)"
                />
                <span v-else>🖼</span>
              </template>
              <span v-else>{{ isImage(entry) ? '🖼' : '📄' }}</span>
            </div>

            <div class="name" :title="entry.inputPath">
              {{ entry.filename }}
              <span v-if="entry.relativeName && entry.relativeName !== entry.filename" class="sub">
                {{ entry.relativeName }}
              </span>
            </div>
            <div class="sz">{{ formatBytes(entry.inputBytes) }}</div>
            <div class="arrow">→</div>
            <div class="sz2">{{ entry.resultBytes == null ? '' : formatBytes(entry.resultBytes) }}</div>
            <div
              class="reduce"
              :class="{ err: entry.error, zero: !entry.error && entry.savedPercent === 0 }"
              :title="entry.error || ''"
            >
              {{ entry.error ? '✕' : entry.savedPercent == null ? '' : entry.savedPercent === 0 ? '-0%' : `-${entry.savedPercent}%` }}
            </div>
            <button
              v-if="canReplace(entry)"
              class="row-action replace"
              type="button"
              :title="replacedEntries.has(entry.id) ? '已替换，点击可再次替换' : '替换原图'"
              @click="replaceOne(activeBatch, entry)"
            >
              <Check v-if="replacedEntries.has(entry.id)" class="completed-icon" :size="15" :stroke-width="2.2" aria-hidden="true" />
              <Replace v-else :size="15" :stroke-width="2" aria-hidden="true" />
            </button>
            <span v-else class="row-action-placeholder" aria-hidden="true"></span>
            <button
              class="row-action copy"
              type="button"
              :title="copiedEntries.has(entry.id) ? '已复制，点击可再次复制' : '复制文件'"
              @click="copyOne(entry)"
            >
              <Check v-if="copiedEntries.has(entry.id)" class="completed-icon" :size="15" :stroke-width="2.2" aria-hidden="true" />
              <Copy v-else :size="15" :stroke-width="2" aria-hidden="true" />
            </button>
          </div>
        </div>
      </main>

      <footer v-if="activeBatch.phase !== 'scanning'" class="status">
        <button class="settings-button" type="button" title="设置" @click="emit('openSettings')">
          <SettingsIcon :size="16" :stroke-width="2" aria-hidden="true" />
        </button>
        <div class="left">
          完成 <b>{{ activeBatch.progress.percent || 0 }}%</b>
          成功 <b>{{ activeBatch.progress.succeeded }}</b>
          失败 <b>{{ activeBatch.progress.failed }}</b>
        </div>

        <div v-if="activeBatch.phase === 'complete' && activeBatch.entries.length > 0" class="center">
          节省 <span class="bytes">{{ formatBytes(savedSummary.bytes) }}</span> {{ savedSummary.percent }}%
        </div>

        <div class="spacer"></div>
        <button
          v-if="activeBatch.phase === 'running' || activeBatch.phase === 'pending'"
          class="btn danger"
          type="button"
          @click="cancelBatch(activeBatch)"
        >
          停止处理
        </button>
        <button
          v-else-if="activeBatch.phase === 'complete' && replaceCount > 0"
          class="btn"
          type="button"
          @click="replaceInputs(activeBatch, replaceCount)"
        >
          覆盖原图 ({{ replaceCount }})
        </button>
        <button
          v-if="activeBatch.phase === 'complete' && activeBatch.entries.length > 0"
          class="btn primary"
          type="button"
          :disabled="copyTargets(activeBatch).length === 0"
          @click="copyAll(activeBatch)"
        >
          复制全部<kbd>Ctrl+C</kbd>
        </button>
      </footer>
    </div>

    <div v-else class="empty">
      <div class="big">🖼</div>
      <div>将图片或文件夹拖到这里，也可以直接粘贴截图</div>
    </div>

    <button
      v-if="!activeBatch"
      class="settings-button settings-button-floating"
      type="button"
      title="设置"
      @click="emit('openSettings')"
    >
      <SettingsIcon :size="16" :stroke-width="2" aria-hidden="true" />
    </button>

    <div v-if="dropVisible" class="drop-overlay">松开以导入文件</div>
  </div>
</template>
