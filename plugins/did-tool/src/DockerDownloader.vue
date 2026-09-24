<script setup lang="ts">
import {
  AlertTriangle,
  Box,
  Check,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Clock3,
  Database,
  FolderOpen,
  Gauge,
  HardDriveDownload,
  LoaderCircle,
  PackageCheck,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  X,
  XCircle
} from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import SettingsPage from './SettingsPage.vue'
import { buildProxyUrl, cloneSettings, createDefaultSettings, normalizeSettings } from './settings'

const pluginLogo = './logo.png'

const runtimeAvailable = 'services' in window
const currentPage = ref<'home' | 'settings'>('home')
const defaultDownloadPath = ref('~/Downloads/did-tool')
const settings = ref<AppSettings>(createDefaultSettings(defaultDownloadPath.value))
const settingsSaveError = ref('')
const form = reactive({
  image: '',
  platform: 'linux/amd64'
})
const inspection = ref<DockerInspection | null>(null)
const task = ref<DownloadTask | null>(null)
const inspectError = ref('')
const inspecting = ref(false)
const copied = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null
let polling = false
let handledTerminalTask = ''
let inspectionGeneration = 0

const terminalStatuses: DownloadStatus[] = ['completed', 'failed', 'cancelled']
const selectedSource = computed<ImageSourceSetting | null>(
  () =>
    settings.value.sources.find((source) => source.id === settings.value.selectedSourceId) ||
    settings.value.sources[0] ||
    null
)
const taskRunning = computed(() => !!task.value && !terminalStatuses.includes(task.value.status))
const canInspect = computed(
  () => runtimeAvailable && !!selectedSource.value && !!form.image.trim() && !inspecting.value && !taskRunning.value
)
const canStart = computed(
  () =>
    runtimeAvailable &&
    !!inspection.value &&
    !!selectedSource.value &&
    !!settings.value.downloadPath &&
    !taskRunning.value
)
const downloadPercent = computed(() => {
  if (!task.value) return 0
  if (task.value.status === 'packing') {
    return percentage(task.value.packedBytes, task.value.packTotalBytes)
  }
  if (['processing', 'completed'].includes(task.value.status)) return 100
  return percentage(task.value.downloadedBytes, task.value.totalBytes)
})
const progressCaption = computed(() => {
  if (!task.value) return ''
  if (task.value.status === 'packing') {
    return `${formatBytes(task.value.packedBytes)} / ${formatBytes(task.value.packTotalBytes)}`
  }
  return `${formatBytes(task.value.downloadedBytes)} / ${formatBytes(task.value.totalBytes)}`
})
const latestLogs = computed(() => task.value?.logs.slice(-5).reverse() || [])

watch(
  () => form.image,
  () => invalidateInspection(),
  { flush: 'sync' }
)

/** 清除已经不再匹配当前表单的解析结果。 */
function invalidateInspection(resetPlatform = true): void {
  inspectionGeneration += 1
  inspection.value = null
  inspectError.value = ''
  if (resetPlatform) form.platform = 'linux/amd64'
}

/** 将未知异常转换为界面文案。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 构造传给 preload 的下载参数。 */
function requestOptions(): DockerRequestOptions {
  const source = selectedSource.value
  if (!source) throw new Error('请先在设置中添加镜像源')
  const proxyUrl = selectedSource.value?.proxyEnabled ? buildProxyUrl(settings.value.proxy) : ''
  return {
    image: form.image.trim(),
    source: 'custom',
    customRegistry: source.url.trim(),
    platform: form.platform,
    outputDir: settings.value.downloadPath,
    concurrency: 3,
    proxyMode: proxyUrl ? 'custom' : 'none',
    proxyUrl,
    verifySsl: true,
    username: source.username.trim(),
    password: source.password
  }
}

/** 读取远端镜像清单。 */
async function inspectImage(): Promise<void> {
  if (!canInspect.value) return
  inspectError.value = ''
  inspecting.value = true
  const generation = ++inspectionGeneration
  try {
    const result = await window.services.inspectImage(requestOptions())
    if (generation !== inspectionGeneration) return
    inspection.value = result
    form.platform = result.selectedPlatform.key
  } catch (error) {
    if (generation !== inspectionGeneration) return
    inspection.value = null
    inspectError.value = errorMessage(error)
  } finally {
    inspecting.value = false
  }
}

/** 切换目标架构并重新读取对应清单。 */
async function selectPlatform(event: Event): Promise<void> {
  const platform = (event.target as HTMLSelectElement).value
  if (!platform || platform === form.platform || inspecting.value) return
  form.platform = platform
  await inspectImage()
}

/** 切换首页当前使用的镜像源。 */
function selectSource(event: Event): void {
  const sourceId = (event.target as HTMLSelectElement).value
  if (!settings.value.sources.some((source) => source.id === sourceId)) return
  settings.value.selectedSourceId = sourceId
  invalidateInspection()
  persistSettings()
}

/** 保存当前镜像源选择。 */
function persistSettings(): void {
  if (!runtimeAvailable) return
  try {
    window.services.saveSettings(cloneSettings(settings.value))
  } catch (error) {
    inspectError.value = `保存设置失败：${errorMessage(error)}`
  }
}

/** 打开独立设置页面。 */
function openSettings(): void {
  settingsSaveError.value = ''
  currentPage.value = 'settings'
}

/** 保存设置页提交的配置。 */
function applySettings(nextSettings: AppSettings): void {
  settingsSaveError.value = ''
  const normalized = normalizeSettings(nextSettings, defaultDownloadPath.value)
  try {
    if (runtimeAvailable) window.services.saveSettings(normalized)
    settings.value = normalized
    invalidateInspection()
    currentPage.value = 'home'
  } catch (error) {
    settingsSaveError.value = `保存设置失败：${errorMessage(error)}`
  }
}

/** 放弃设置页尚未保存的修改。 */
function closeSettings(): void {
  settingsSaveError.value = ''
  currentPage.value = 'home'
}

/** 启动镜像下载任务。 */
function startDownload(): void {
  if (!canStart.value) return
  inspectError.value = ''
  handledTerminalTask = ''
  try {
    task.value = window.services.startDownload(requestOptions())
    startPolling()
  } catch (error) {
    inspectError.value = errorMessage(error)
  }
}

/** 周期性同步后台任务状态。 */
function startPolling(): void {
  stopPolling()
  pollTimer = setInterval(pollTask, 350)
  void pollTask()
}

/** 停止任务状态轮询。 */
function stopPolling(): void {
  if (!pollTimer) return
  clearInterval(pollTimer)
  pollTimer = null
}

/** 获取一次后台任务快照。 */
async function pollTask(): Promise<void> {
  if (!task.value || polling) return
  polling = true
  try {
    const snapshot = window.services.getDownloadTask(task.value.id)
    if (!snapshot) return
    task.value = snapshot
    if (terminalStatuses.includes(snapshot.status)) {
      stopPolling()
      handleTaskFinished(snapshot)
    }
  } finally {
    polling = false
  }
}

/** 处理任务结束通知。 */
function handleTaskFinished(snapshot: DownloadTask): void {
  if (handledTerminalTask === snapshot.id) return
  handledTerminalTask = snapshot.id
  if (snapshot.status === 'completed') {
    window.ztools?.showNotification(`镜像包已生成：${snapshot.fileName}`, 'Docker 镜像下载工具')
  }
}

/** 请求取消当前任务。 */
function cancelDownload(): void {
  if (task.value) window.services.cancelDownloadTask(task.value.id)
}

/** 在文件管理器中定位生成的镜像包。 */
function revealOutput(filePath: string): void {
  if (runtimeAvailable) window.services.showOutputInFolder(filePath)
}

/** 在文件管理器中定位已经存在的镜像包。 */
function revealExistingOutput(): void {
  const existingOutputPath = inspection.value?.existingOutputPath
  if (existingOutputPath) revealOutput(existingOutputPath)
}

/** 复制 docker load 命令。 */
async function copyLoadCommand(filePath: string): Promise<void> {
  const command = `docker load -i "${filePath}"`
  if ('ztools' in window) window.ztools.copyText(command)
  else await navigator.clipboard.writeText(command)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 1600)
}

/** 计算百分比并限制在合理范围。 */
function percentage(value: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, (value / total) * 100))
}

/** 格式化字节数。 */
function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const amount = value / 1024 ** index
  return `${amount >= 100 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`
}

/** 格式化剩余时长。 */
function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '--'
  if (seconds < 60) return `${Math.max(1, seconds)} 秒`
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} 分钟`
  return `${Math.floor(seconds / 3600)} 小时 ${Math.ceil((seconds % 3600) / 60)} 分`
}

/** 返回平台的紧凑显示名称。 */
function platformLabel(platform: DockerPlatform): string {
  const variant = platform.variant ? ` / ${platform.variant}` : ''
  return `${platform.os} / ${platform.architecture}${variant}`
}

/** 返回下载文件状态文案。 */
function layerStatusLabel(status: DownloadLayer['status']): string {
  const labels: Record<DownloadLayer['status'], string> = {
    pending: '等待中',
    downloading: '下载中',
    verifying: '校验中',
    retrying: '重试中',
    processing: '处理中',
    completed: '已完成'
  }
  return labels[status]
}

/** 返回任务状态文案。 */
function taskStatusLabel(status: DownloadStatus): string {
  const labels: Record<DownloadStatus, string> = {
    preparing: '准备中',
    downloading: '下载中',
    processing: '处理中',
    packing: '打包中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消'
  }
  return labels[status]
}

/** 返回任务状态对应的样式名。 */
function statusTone(status: DownloadStatus): string {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'cancelled') return 'muted'
  return 'active'
}

onMounted(() => {
  if (!runtimeAvailable) return
  defaultDownloadPath.value = window.services.getDefaults().outputDir
  try {
    settings.value = normalizeSettings(window.services.loadSettings(), defaultDownloadPath.value)
    window.services.saveSettings(cloneSettings(settings.value))
  } catch (error) {
    settings.value = createDefaultSettings(defaultDownloadPath.value)
    inspectError.value = `读取设置失败：${errorMessage(error)}`
  }
})

onBeforeUnmount(stopPolling)
</script>

<template>
  <SettingsPage
    v-if="currentPage === 'settings'"
    :settings="settings"
    :default-download-path="defaultDownloadPath"
    :runtime-available="runtimeAvailable"
    :save-error="settingsSaveError"
    @back="closeSettings"
    @save="applySettings"
  />

  <div v-else class="app-shell">
    <div v-if="!runtimeAvailable" class="runtime-notice">
      <Server :size="17" />
      当前为浏览器预览，镜像下载功能需在 ZTools 中运行。
    </div>

    <main class="download-view">
      <section class="config-section">
        <div class="section-heading">
          <div>
            <h1>{{ selectedSource?.proxyEnabled ? '镜像下载（代理）' : '镜像下载' }}</h1>
            <p v-if="selectedSource">{{ selectedSource.url }}</p>
          </div>
          <button
            type="button"
            class="icon-button"
            title="打开设置"
            aria-label="打开设置"
            @click="openSettings"
          >
            <Settings2 :size="18" />
          </button>
        </div>

        <form class="config-form" @submit.prevent="inspectImage">
          <div class="field">
            <label for="image-source">镜像地址</label>
            <div class="select-wrap leading-icon">
              <Server :size="16" />
              <select
                id="image-source"
                :value="settings.selectedSourceId"
                :disabled="taskRunning"
                @change="selectSource"
              >
                <option v-for="source in settings.sources" :key="source.id" :value="source.id">
                  {{ source.name }}
                </option>
              </select>
              <ChevronDown :size="15" />
            </div>
          </div>

          <div class="field">
            <label for="image-name">镜像名称</label>
            <div class="input-with-icon">
              <Box :size="17" />
              <input
                id="image-name"
                v-model="form.image"
                type="text"
                autocomplete="off"
                spellcheck="false"
                placeholder="nginx:latest"
                :disabled="taskRunning"
              />
            </div>
          </div>

          <button class="inspect-button" type="submit" :disabled="!canInspect">
            <LoaderCircle v-if="inspecting" :size="17" class="spin" />
            <Search v-else :size="17" />
            {{ inspecting ? '解析中' : '解析镜像' }}
          </button>
        </form>

        <div v-if="inspectError" class="inline-message error-message">
          <XCircle :size="17" />
          <span>{{ inspectError }}</span>
        </div>

        <div v-if="inspection" class="inspection-result">
          <div class="result-facts">
            <div>
              <Database :size="16" />
              <span>{{ formatBytes(inspection.totalSize) }}</span>
              <small>压缩大小</small>
            </div>
            <div>
              <Box :size="16" />
              <span>{{ inspection.layerCount }}</span>
              <small>数据层</small>
            </div>
            <div :title="inspection.manifestDigest">
              <ShieldCheck :size="16" />
              <span>{{ inspection.manifestDigest.slice(7, 19) }}</span>
              <small>清单摘要</small>
            </div>
          </div>

          <div class="field architecture-field">
            <label for="image-platform">镜像架构</label>
            <div class="select-wrap leading-icon">
              <Gauge :size="16" />
              <select
                id="image-platform"
                :value="form.platform"
                :disabled="inspecting || taskRunning"
                @change="selectPlatform"
              >
                <option v-for="platform in inspection.platforms" :key="platform.key" :value="platform.key">
                  {{ platformLabel(platform) }}
                </option>
              </select>
              <ChevronDown :size="15" />
            </div>
          </div>

          <button
            v-if="inspection.existingOutputPath"
            type="button"
            class="output-warning"
            :title="`在文件管理器中检查 ${inspection.outputFileName}`"
            @click="revealExistingOutput"
          >
            <AlertTriangle :size="15" />
            该镜像可能已下载，点击检查
          </button>
          <button class="primary-button" type="button" :disabled="!canStart" @click="startDownload">
            <HardDriveDownload :size="18" />
            开始下载
          </button>
        </div>
      </section>

      <section class="task-section" :class="{ empty: !task }">
        <template v-if="task">
          <div class="task-content">
            <div class="task-heading">
            <div class="task-title">
              <LoaderCircle v-if="taskRunning" :size="19" class="spin" />
              <CheckCircle2 v-else-if="task.status === 'completed'" :size="20" />
              <XCircle v-else-if="task.status === 'failed'" :size="20" />
              <Clock3 v-else :size="19" />
              <div>
                <h2>{{ task.phase }}</h2>
                <p>{{ task.image }} · {{ task.platform }}</p>
              </div>
            </div>
            <div class="task-actions">
              <span class="status-badge" :class="statusTone(task.status)">{{ taskStatusLabel(task.status) }}</span>
              <button v-if="taskRunning" type="button" class="cancel-button" @click="cancelDownload">
                <X :size="15" />
                取消
              </button>
            </div>
          </div>

          <div class="progress-block">
            <div class="progress-meta">
              <strong>{{ downloadPercent.toFixed(1) }}%</strong>
              <span>{{ progressCaption }}</span>
            </div>
            <div
              class="progress-track"
              role="progressbar"
              :aria-valuenow="downloadPercent"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <span :class="statusTone(task.status)" :style="{ width: `${downloadPercent}%` }" />
            </div>
          </div>

          <div class="task-stats">
            <div>
              <Gauge :size="17" />
              <span>{{ task.speed > 0 ? `${formatBytes(task.speed)}/s` : '--' }}</span>
              <small>当前速度</small>
            </div>
            <div>
              <Clock3 :size="17" />
              <span>{{ formatDuration(task.etaSeconds) }}</span>
              <small>预计剩余</small>
            </div>
            <div>
              <Database :size="17" />
              <span>{{ task.layers.filter((layer) => layer.status === 'completed').length }} / {{ task.layers.length }}</span>
              <small>文件进度</small>
            </div>
          </div>

          <div v-if="task.layers.length" class="layer-list">
            <div class="layer-list-header">
              <span>文件</span>
              <span>进度</span>
              <span>状态</span>
            </div>
            <div class="layer-list-body">
              <div v-for="(layer, index) in task.layers" :key="`${layer.kind}-${layer.digest}-${index}`" class="layer-row">
                <div class="layer-name">
                  <Box v-if="layer.kind === 'layer'" :size="15" />
                  <Database v-else :size="15" />
                  <span>{{ layer.label }}</span>
                  <code>{{ layer.shortDigest }}</code>
                </div>
                <div class="layer-progress">
                  <span :style="{ width: `${percentage(layer.downloaded, layer.size)}%` }" />
                </div>
                <span class="layer-status" :class="layer.status">{{ layerStatusLabel(layer.status) }}</span>
              </div>
            </div>
          </div>

          <div v-if="task.error" class="inline-message error-message task-error">
            <XCircle :size="17" />
            <span>{{ task.error }}</span>
          </div>

          <div v-if="task.status === 'completed'" class="completed-output">
            <PackageCheck :size="20" />
            <div>
              <strong>{{ task.fileName }}</strong>
              <span>{{ task.outputPath }}</span>
            </div>
            <button
              type="button"
              class="icon-button"
              title="复制导入命令"
              aria-label="复制导入命令"
              @click="copyLoadCommand(task.outputPath)"
            >
              <Check v-if="copied" :size="17" />
              <Clipboard v-else :size="17" />
            </button>
            <button
              type="button"
              class="icon-button"
              title="在文件管理器中显示"
              aria-label="在文件管理器中显示"
              @click="revealOutput(task.outputPath)"
            >
              <FolderOpen :size="17" />
            </button>
          </div>

            <div v-if="latestLogs.length" class="task-log">
              <div v-for="log in latestLogs" :key="`${log.time}-${log.message}`" :class="log.level">
                <time>{{ new Date(log.time).toLocaleTimeString('zh-CN', { hour12: false }) }}</time>
                <span>{{ log.message }}</span>
              </div>
            </div>
          </div>
        </template>

        <div v-else class="empty-state">
          <div class="empty-logo-frame"><img :src="pluginLogo" alt="" /></div>
          <h2>等待下载任务</h2>
          <p>{{ inspection ? '镜像清单已解析，可以开始下载。' : '解析镜像后，下载进度将在此显示。' }}</p>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  height: 100vh;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--text-primary);
  background: var(--app-background);
}

.runtime-notice {
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 7px 20px;
  box-sizing: border-box;
  color: #805b12;
  background: #fff7df;
  border-bottom: 1px solid #eedaa3;
  font-size: 13px;
}

.download-view {
  display: grid;
  grid-template-columns: minmax(330px, 38%) minmax(420px, 62%);
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
}

.runtime-notice + .download-view {
  min-height: 0;
}

.config-section,
.task-section {
  padding: 22px 24px 26px;
  box-sizing: border-box;
}

.config-section {
  min-height: 0;
  border-right: 1px solid var(--border-color);
  background: var(--surface-color);
  overflow-y: auto;
}

.section-heading,
.task-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.section-heading {
  min-height: 36px;
  margin-bottom: 20px;
}

.section-heading h1,
.section-heading p,
.task-heading h2,
.task-heading p,
.empty-state h2,
.empty-state p {
  margin: 0;
}

.section-heading h1,
.task-heading h2,
.empty-state h2 {
  font-size: 15px;
  line-height: 20px;
  font-weight: 650;
  letter-spacing: 0;
}

.section-heading p,
.task-heading p,
.empty-state p {
  max-width: 100%;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.config-form {
  display: grid;
  gap: 14px;
}

.field {
  min-width: 0;
}

.field label {
  display: block;
  margin-bottom: 7px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 550;
}

.input-with-icon,
.select-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.input-with-icon > svg,
.select-wrap.leading-icon > svg:first-child {
  position: absolute;
  left: 10px;
  z-index: 1;
  color: var(--text-muted);
  pointer-events: none;
}

.input-with-icon input,
.select-wrap.leading-icon select {
  padding-left: 34px;
}

input,
select {
  width: 100%;
  height: 37px;
  min-width: 0;
  padding: 0 11px;
  border: 1px solid var(--control-border);
  border-radius: 6px;
  outline: none;
  box-sizing: border-box;
  color: var(--text-primary);
  background: var(--control-background);
  font: inherit;
  font-size: 13px;
  letter-spacing: 0;
  transition: border-color 0.16s, box-shadow 0.16s;
}

input::placeholder {
  color: var(--placeholder-color);
}

input:focus,
select:focus {
  border-color: var(--accent-color);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

input:disabled,
select:disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

select {
  appearance: none;
  padding-right: 30px;
  cursor: pointer;
}

.select-wrap > svg:last-child {
  position: absolute;
  right: 9px;
  color: var(--text-muted);
  pointer-events: none;
}

.icon-button,
.inspect-button,
.primary-button,
.cancel-button {
  border: 0;
  font: inherit;
  cursor: pointer;
}

.icon-button {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 6px;
  color: var(--text-secondary);
  background: transparent;
}

.icon-button:hover:not(:disabled) {
  color: var(--accent-color);
  background: var(--accent-soft);
}

.icon-button:disabled,
.inspect-button:disabled,
.primary-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.inspect-button,
.primary-button,
.cancel-button {
  height: 37px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.inspect-button {
  width: 100%;
  margin-top: 2px;
  color: var(--accent-color);
  border: 1px solid var(--accent-border);
  background: var(--accent-soft);
}

.output-warning {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  margin-top: 14px;
  padding: 0;
  border: 0;
  color: var(--warning-color);
  background: transparent;
  font: inherit;
  font-size: 11px;
  line-height: 17px;
  cursor: pointer;
}

.output-warning:hover {
  color: var(--accent-color);
  text-decoration: underline;
}

.output-warning:focus-visible {
  outline: 2px solid var(--accent-color);
  outline-offset: 2px;
}

.output-warning + .primary-button {
  margin-top: 4px;
}

.primary-button {
  width: 100%;
  margin-top: 17px;
  color: #fff;
  background: var(--accent-color);
}

.primary-button:hover:not(:disabled) {
  background: var(--accent-hover);
}

.inline-message {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 14px;
  padding: 10px 11px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 17px;
}

.inline-message svg {
  flex: 0 0 auto;
  margin-top: 1px;
}

.error-message {
  color: var(--danger-color);
  border: 1px solid var(--danger-border);
  background: var(--danger-soft);
}

.inspection-result {
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid var(--border-color);
}

.result-facts,
.task-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.result-facts > div,
.task-stats > div {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  column-gap: 6px;
  align-items: center;
}

.result-facts svg,
.task-stats svg {
  grid-row: 1 / 3;
  color: var(--accent-color);
}

.result-facts span,
.task-stats span {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-facts small,
.task-stats small {
  color: var(--text-muted);
  font-size: 11px;
}

.architecture-field {
  margin-top: 18px;
}

.task-section {
  min-width: 0;
  min-height: 0;
  padding: 18px 22px 20px;
  overflow: hidden;
}

.task-content {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.task-section.empty {
  display: flex;
  align-items: center;
  justify-content: center;
}

.task-heading {
  min-height: 34px;
  margin-bottom: 14px;
}

.task-title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.task-title > svg {
  flex: 0 0 auto;
  color: var(--accent-color);
}

.task-title > div {
  min-width: 0;
}

.task-actions {
  display: flex;
  align-items: center;
  gap: 5px;
}

.status-badge {
  padding: 4px 8px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 650;
}

.status-badge.active {
  color: var(--accent-color);
  background: var(--accent-soft);
}

.status-badge.success {
  color: var(--success-color);
  background: var(--success-soft);
}

.status-badge.danger {
  color: var(--danger-color);
  background: var(--danger-soft);
}

.status-badge.muted {
  color: var(--text-muted);
  background: var(--subtle-background-strong);
}

.cancel-button {
  height: 30px;
  padding: 0 9px;
  color: var(--danger-color);
  background: var(--danger-soft);
}

.progress-meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 6px;
}

.progress-meta strong {
  font-size: 21px;
  line-height: 22px;
  font-variant-numeric: tabular-nums;
}

.progress-meta span {
  color: var(--text-muted);
  font-size: 12px;
}

.progress-track,
.layer-progress {
  overflow: hidden;
  background: var(--subtle-background-strong);
}

.progress-track {
  height: 8px;
  border-radius: 4px;
}

.progress-track > span,
.layer-progress > span {
  display: block;
  height: 100%;
  background: var(--accent-color);
  transition: width 0.28s ease;
}

.progress-track > span.success {
  background: var(--success-color);
}

.progress-track > span.danger {
  background: var(--danger-color);
}

.progress-track > span.muted {
  background: var(--text-muted);
}

.task-stats {
  margin: 14px 0;
  padding: 10px 0;
  border-top: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
}

.layer-list {
  min-height: 0;
  display: flex;
  flex: 0 1 auto;
  flex-direction: column;
  max-height: 100%;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  overflow: hidden;
}

.layer-list-body {
  min-height: 0;
  overflow-y: auto;
}

.layer-list-header,
.layer-row {
  display: grid;
  grid-template-columns: minmax(180px, 1.5fr) minmax(90px, 0.8fr) 62px;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
}

.layer-list-header {
  height: 28px;
  color: var(--text-muted);
  background: var(--subtle-background);
  font-size: 11px;
  font-weight: 600;
}

.layer-row {
  min-height: 28px;
  border-top: 1px solid var(--border-color);
  background: var(--surface-color);
}

.layer-name {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--text-secondary);
  font-size: 12px;
}

.layer-name svg {
  flex: 0 0 auto;
  color: var(--text-muted);
}

.layer-name code {
  overflow: hidden;
  color: var(--text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
}

.layer-progress {
  height: 4px;
  border-radius: 2px;
}

.layer-status {
  justify-self: end;
  color: var(--text-muted);
  font-size: 11px;
}

.layer-status.downloading,
.layer-status.verifying,
.layer-status.processing {
  color: var(--accent-color);
}

.layer-status.completed {
  color: var(--success-color);
}

.layer-status.retrying {
  color: var(--warning-color);
}

.task-error {
  margin-top: 10px;
}

.completed-output {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  padding: 9px 10px;
  border: 1px solid var(--success-border);
  border-radius: 7px;
  color: var(--success-color);
  background: var(--success-soft);
}

.completed-output > div {
  min-width: 0;
}

.completed-output strong,
.completed-output span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.completed-output strong {
  font-size: 12px;
}

.completed-output span {
  margin-top: 2px;
  color: var(--text-muted);
  font-size: 11px;
}

.task-log {
  margin-top: 8px;
  color: var(--text-muted);
  font-family: inherit;
  font-size: 11px;
  line-height: 16px;
}

.task-log > div {
  display: flex;
  gap: 8px;
}

.task-log time {
  flex: 0 0 auto;
  color: var(--placeholder-color);
  font-variant-numeric: tabular-nums;
}

.task-log .error,
.task-log .warning {
  color: var(--warning-color);
}

.task-log .success {
  color: var(--success-color);
}

.empty-state {
  max-width: 320px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px;
  color: var(--text-muted);
  text-align: center;
}

.empty-logo-frame {
  width: 132px;
  height: 82px;
  margin-bottom: 14px;
  overflow: hidden;
  opacity: 0.72;
}

.empty-logo-frame img {
  width: 132px;
  height: 132px;
  display: block;
  transform: translateY(-26px);
}

.empty-state p {
  margin-top: 5px;
  white-space: normal;
}

.spin {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 760px) {
  .download-view {
    grid-template-columns: 1fr;
  }

  .config-section {
    border-right: 0;
    border-bottom: 1px solid var(--border-color);
  }

  .task-section.empty {
    min-height: 300px;
  }
}

@media (max-width: 460px) {
  .config-section,
  .task-section {
    padding: 18px 16px 22px;
  }

  .layer-list-header,
  .layer-row {
    grid-template-columns: minmax(130px, 1fr) 72px 55px;
    gap: 8px;
    padding: 0 9px;
  }

  .layer-name code {
    display: none;
  }
}
</style>
