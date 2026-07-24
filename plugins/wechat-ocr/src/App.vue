<template>
  <main class="ocr-shell">
    <section class="workbench">
      <section
        class="preview-pane"
        :class="{ dragging: isDragging }"
        @dragenter.prevent="isDragging = true"
        @dragover.prevent
        @dragleave.prevent="isDragging = false"
        @drop.prevent="onDrop"
      >
        <div v-if="!previewSrc" class="empty-state">
          <div class="empty-icon">▧</div>
          <div class="empty-title">选择图片或截图</div>
          <div class="empty-subtitle">支持 png、jpg、webp、bmp、tiff</div>
        </div>
        <img v-else class="preview-image" :src="previewSrc" alt="待识别图片">
        <div v-if="runtimeOverlayVisible" class="runtime-mask">
          <span v-if="runtimeBusy" class="spinner"></span>
          <div class="runtime-title">{{ runtimeTitle }}</div>
          <div class="runtime-message">{{ runtimeMessage }}</div>
          <div v-if="runtimeProgressVisible" class="runtime-progress">
            <div class="runtime-progress-bar" :style="{ width: `${runtimeProgress.percent}%` }"></div>
          </div>
          <div v-if="runtimeProgressVisible" class="runtime-progress-text">{{ runtimeProgressText }}</div>
          <button
            v-if="runtimeCanDownload"
            type="button"
            class="runtime-download-button"
            @click="startRuntimeDownload"
          >
            {{ runtimeButtonText }}
          </button>
        </div>
        <div v-if="loading" class="busy-mask">
          <span class="spinner"></span>
          <span>{{ loadingMessage }}</span>
          <span v-if="isFirstRunLoading" class="loading-note">首次使用需要初始化 OCR 模型</span>
        </div>
      </section>

      <section class="result-pane">
        <textarea
          v-model="displayText"
          spellcheck="false"
          placeholder="识别结果会显示在这里"
        ></textarea>
      </section>
    </section>

    <footer class="toolbar">
      <div class="left-actions">
        <button type="button" class="tool-button" :disabled="loading || !runtimeReady" @click="selectImage">
          <span class="icon">▧</span>
          <span>选择图片</span>
        </button>
        <button type="button" class="tool-button" :disabled="loading || !runtimeReady" @click="captureScreen">
          <span class="icon">⌗</span>
          <span>屏幕截图</span>
        </button>
      </div>

      <label class="toggle">
        <input v-model="stripNewlines" type="checkbox">
        <span class="switch"></span>
        <span>去除换行符</span>
      </label>

      <div class="right-actions">
        <button type="button" class="tool-button" :disabled="loading || !hasContent" @click="clearAll">
          <span class="icon">×</span>
          <span>清空</span>
        </button>
        <button type="button" class="copy-button" :disabled="loading || !displayText" @click="copyResult">
          <span class="copy-icon">⧉</span>
          <span>复制结果</span>
        </button>
      </div>
    </footer>

    <input ref="fileInput" class="file-input" type="file" accept="image/*" @change="onFileSelected">
    <div v-if="toastMessage" class="toast">{{ toastMessage }}</div>
  </main>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const OCR_IMAGE_STORAGE_KEY = 'wechat_ocr_image'
const OCR_IMAGE_EVENT = 'wechat-ocr-image'
const OCR_CAPTURE_CODE = 'wechat-ocr-capture'

const fileInput = ref(null)
const previewSrc = ref('')
const rawResultText = ref('')
const loading = ref(false)
const loadingMessage = ref('识别中')
const isFirstRunLoading = ref(false)
const stripNewlines = ref(false)
const isDragging = ref(false)
const toastMessage = ref('')
const runtimeStatus = ref('checking')
const runtimeMessage = ref('正在检查 OCR 运行时')
const runtimeVersion = ref('')
const runtimeLatestVersion = ref('')
const runtimeProgress = ref({
  phase: '',
  percent: 0,
  downloaded: 0,
  total: 0
})

let toastTimer = 0
let lastSource = ''
let hasRecognizedOnce = false
let pendingRecognition = null

const hasContent = computed(() => Boolean(previewSrc.value || rawResultText.value))
const runtimeReady = computed(() => runtimeStatus.value === 'ready')
const runtimeBusy = computed(() => ['checking', 'downloading', 'extracting'].includes(runtimeStatus.value))
const runtimeCanDownload = computed(() => ['missing', 'outdated', 'error'].includes(runtimeStatus.value))
const runtimeOverlayVisible = computed(() => !runtimeReady.value)
const runtimeProgressVisible = computed(() => ['downloading', 'extracting'].includes(runtimeStatus.value))
const runtimeTitle = computed(() => {
  if (runtimeStatus.value === 'checking') return '检查 OCR 运行时'
  if (runtimeStatus.value === 'downloading') return '下载 OCR 运行时'
  if (runtimeStatus.value === 'extracting') return '安装 OCR 运行时'
  if (runtimeStatus.value === 'outdated') return '更新 OCR 运行时'
  if (runtimeStatus.value === 'error') return 'OCR 运行时不可用'
  return '下载 OCR 运行时'
})
const runtimeButtonText = computed(() => runtimeStatus.value === 'outdated' ? '下载更新' : '下载 OCR 运行时')
const runtimeProgressText = computed(() => {
  const percent = Math.max(0, Math.min(100, runtimeProgress.value.percent || 0))
  if (runtimeStatus.value === 'extracting') return `正在解包 ${percent}%`
  const total = runtimeProgress.value.total
  const downloaded = runtimeProgress.value.downloaded
  if (total) return `${formatBytes(downloaded)} / ${formatBytes(total)} · ${percent}%`
  return percent ? `${percent}%` : '正在下载'
})

function stripLineBreaks(text) {
  return String(text || '').replace(/\s*\r?\n\s*/g, '')
}

const displayText = computed({
  get() {
    return stripNewlines.value ? stripLineBreaks(rawResultText.value) : rawResultText.value
  },
  set(value) {
    rawResultText.value = stripNewlines.value ? stripLineBreaks(value) : value
  }
})

function showToast(message) {
  toastMessage.value = message
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toastMessage.value = ''
  }, 1800)
}

function formatError(error) {
  return error && error.message ? error.message : String(error || '操作失败')
}

function formatBytes(bytes) {
  const value = Number(bytes || 0)
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${value} B`
}

function applyRuntimeStatus(info) {
  runtimeVersion.value = info?.version || ''
  runtimeLatestVersion.value = info?.latestVersion || ''
  if (info?.ready) {
    runtimeStatus.value = 'ready'
    runtimeMessage.value = info.message || ''
    runtimeProgress.value = { phase: '', percent: 100, downloaded: 0, total: 0 }
    return true
  }
  runtimeStatus.value = info?.status || 'missing'
  runtimeMessage.value = info?.message || '需要下载 OCR 运行时后才能识别'
  runtimeProgress.value = { phase: '', percent: 0, downloaded: 0, total: 0 }
  return false
}

async function refreshRuntimeStatus() {
  if (!window.wechatOcr?.checkRuntime) {
    runtimeStatus.value = 'error'
    runtimeMessage.value = '当前环境不支持 OCR 运行时检查'
    return false
  }
  runtimeStatus.value = 'checking'
  runtimeMessage.value = '正在检查 OCR 运行时'
  try {
    return applyRuntimeStatus(await window.wechatOcr.checkRuntime())
  } catch (error) {
    runtimeStatus.value = 'error'
    runtimeMessage.value = formatError(error)
    return false
  }
}

async function startRuntimeDownload() {
  if (!window.wechatOcr?.installRuntime) {
    runtimeStatus.value = 'error'
    runtimeMessage.value = '当前环境不支持 OCR 运行时下载'
    return
  }
  runtimeStatus.value = 'checking'
  runtimeMessage.value = '正在获取 OCR 运行时版本'
  runtimeProgress.value = { phase: 'metadata', percent: 0, downloaded: 0, total: 0 }
  try {
    const status = await window.wechatOcr.installRuntime((progress = {}) => {
      const phase = progress.phase || ''
      if (progress.version) runtimeLatestVersion.value = progress.version
      runtimeProgress.value = {
        phase,
        percent: Number(progress.percent || 0),
        downloaded: Number(progress.downloaded || 0),
        total: Number(progress.total || 0)
      }
      if (phase === 'download') {
        runtimeStatus.value = 'downloading'
        runtimeMessage.value = runtimeLatestVersion.value
          ? `正在下载 ${runtimeLatestVersion.value}`
          : '正在下载 OCR 运行时'
      } else if (phase === 'extract') {
        runtimeStatus.value = 'extracting'
        runtimeMessage.value = '正在解包 OCR 运行时'
      } else if (phase === 'done') {
        runtimeStatus.value = 'ready'
        runtimeMessage.value = ''
      }
    })
    applyRuntimeStatus(status)
    showToast('OCR 运行时已就绪')
    const pending = pendingRecognition
    pendingRecognition = null
    if (pending) await recognizeSource(pending.source, pending.preview)
  } catch (error) {
    runtimeStatus.value = 'error'
    runtimeMessage.value = formatError(error)
  }
}

async function waitForUiPaint() {
  await nextTick()
  await new Promise((resolve) => {
    if (typeof window.requestAnimationFrame !== 'function') {
      window.setTimeout(resolve, 0)
      return
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(resolve)
    })
  })
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

async function previewForSource(source) {
  if (typeof source === 'string' && source.startsWith('data:image/')) return source
  if (window.wechatOcr?.readImageDataUrl) {
    return window.wechatOcr.readImageDataUrl(source)
  }
  return ''
}

async function recognizeSource(source, preview = '') {
  if (!source || loading.value) return
  if (!runtimeReady.value) {
    pendingRecognition = { source, preview }
    try {
      previewSrc.value = preview || await previewForSource(source)
    } catch (_) {
      // Keep the download prompt usable even if preview loading fails.
    }
    showToast('请先下载 OCR 运行时')
    return
  }
  if (source === lastSource && rawResultText.value) return
  lastSource = source
  loading.value = true
  isFirstRunLoading.value = !hasRecognizedOnce
  loadingMessage.value = isFirstRunLoading.value ? '正在加载 OCR' : '识别中'
  rawResultText.value = ''
  let attemptedRecognition = false
  try {
    previewSrc.value = preview || await previewForSource(source)
    await waitForUiPaint()
    attemptedRecognition = true
    const result = await window.wechatOcr.recognize(source)
    rawResultText.value = result?.text || ''
    if (!rawResultText.value) showToast('未识别到文字')
  } catch (error) {
    rawResultText.value = ''
    showToast(formatError(error))
  } finally {
    if (attemptedRecognition) hasRecognizedOnce = true
    loading.value = false
    isFirstRunLoading.value = false
  }
}

async function handleFile(file) {
  if (!file) return
  try {
    const dataUrl = await readFileAsDataUrl(file)
    const filePath = window.ztools?.getPathForFile ? window.ztools.getPathForFile(file) : ''
    await recognizeSource(filePath || dataUrl, dataUrl)
  } catch (error) {
    showToast(formatError(error))
  }
}

async function selectImage() {
  try {
    if (window.ztools?.showOpenDialog) {
      const files = await Promise.resolve(window.ztools.showOpenDialog({
        properties: ['openFile'],
        filters: [
          {
            name: 'Images',
            extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff']
          }
        ]
      }))
      const filePath = Array.isArray(files) ? files[0] : files?.filePaths?.[0] || files
      if (filePath) {
        recognizeSource(filePath)
        return
      }
    }
  } catch (error) {
    showToast(formatError(error))
  }
  fileInput.value?.click()
}

function onFileSelected(event) {
  const file = event.target.files && event.target.files[0]
  handleFile(file)
  event.target.value = ''
}

function onDrop(event) {
  isDragging.value = false
  const file = event.dataTransfer?.files?.[0]
  handleFile(file)
}

function captureScreen() {
  if (!window.ztools?.screenCapture) {
    showToast('当前环境不支持截图')
    return
  }
  window.ztools.screenCapture((image) => {
    if (image) recognizeSource(image, image)
  })
}

function clearAll() {
  previewSrc.value = ''
  rawResultText.value = ''
  lastSource = ''
}

async function copyResult() {
  const text = displayText.value
  if (!text) {
    showToast('没有可复制的结果')
    return
  }
  try {
    if (window.ztools?.copyText) {
      window.ztools.copyText(text)
    } else if (window.wechatOcr?.copyText) {
      window.wechatOcr.copyText(text)
    } else {
      await navigator.clipboard.writeText(text)
    }
    showToast('已复制')
  } catch (_) {
    showToast('复制失败')
  }
}

async function consumeAction(action) {
  if (action?.code === OCR_CAPTURE_CODE) {
    window.setTimeout(captureScreen, 50)
    return
  }
  const image = window.wechatOcr?.getImageFromAction?.(action)
  if (image) await recognizeSource(image)
}

async function consumePendingImage() {
  const pending = window.__WECHAT_OCR_PENDING_IMAGE__
  if (pending) {
    window.__WECHAT_OCR_PENDING_IMAGE__ = ''
    await recognizeSource(pending)
    return
  }
  try {
    const cached = window.ztools?.dbStorage?.getItem?.(OCR_IMAGE_STORAGE_KEY)
    if (cached) previewSrc.value = await previewForSource(cached)
  } catch (_) {
    // Ignore unavailable storage.
  }
}

function onOcrImageEvent(event) {
  const source = event.detail?.source || event.detail
  if (source) recognizeSource(source)
}

onMounted(async () => {
  window.addEventListener(OCR_IMAGE_EVENT, onOcrImageEvent)
  try {
    window.ztools?.onPluginEnter?.(consumeAction)
  } catch (_) {
    // Ignore host API failures.
  }
  await refreshRuntimeStatus()
  await consumePendingImage()
})

onBeforeUnmount(() => {
  window.removeEventListener(OCR_IMAGE_EVENT, onOcrImageEvent)
  window.clearTimeout(toastTimer)
})
</script>

<style scoped>
.ocr-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 100vh;
  background: var(--bg-app);
  color: var(--text-primary);
}

.workbench {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(360px, 1fr);
  min-height: 0;
  overflow: hidden;
  border-bottom: 1px solid var(--border-color);
}

.preview-pane {
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 0;
  place-items: center;
  overflow: hidden;
  background: var(--bg-panel-muted);
  border-right: 1px solid var(--border-color);
}

.preview-pane.dragging {
  background: var(--bg-hover-light);
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}

.empty-state {
  display: grid;
  gap: 6px;
  place-items: center;
  color: var(--text-secondary);
  text-align: center;
}

.empty-icon {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  color: var(--text-secondary);
  font-size: 22px;
}

.empty-title {
  font-size: 14px;
  font-weight: 650;
  color: var(--text-primary);
}

.empty-subtitle {
  font-size: 12px;
  color: var(--text-tertiary);
}

.preview-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.busy-mask {
  position: absolute;
  inset: 0;
  display: grid;
  gap: 8px;
  place-content: center;
  background: var(--bg-overlay);
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 650;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.runtime-mask {
  position: absolute;
  inset: 0;
  display: grid;
  gap: 10px;
  place-content: center;
  justify-items: center;
  padding: 24px;
  background: var(--bg-overlay);
  color: var(--text-primary);
  text-align: center;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.runtime-title {
  font-size: 15px;
  font-weight: 750;
}

.runtime-message {
  max-width: min(420px, calc(100vw - 48px));
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.runtime-progress {
  width: min(340px, calc(100vw - 56px));
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--switch-bg);
}

.runtime-progress-bar {
  width: 0;
  height: 100%;
  border-radius: inherit;
  background: var(--primary-color);
  transition: width 0.18s ease;
}

.runtime-progress-text {
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 1.4;
}

.runtime-download-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 0 14px;
  border-radius: 7px;
  background: var(--primary-color);
  color: var(--text-white);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 2px 7px var(--primary-shadow);
}

.runtime-download-button:hover {
  background: var(--primary-hover);
}

.loading-note {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
}

.spinner {
  width: 22px;
  height: 22px;
  margin: 0 auto;
  border: 2px solid var(--spinner-bg);
  border-top-color: var(--primary-color);
  border-radius: 999px;
  animation: spin 0.8s linear infinite;
}

.result-pane {
  min-width: 0;
  min-height: 0;
  padding: 0;
  background: var(--bg-panel);
}

.result-pane textarea {
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 18px 20px;
  resize: none;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-primary);
  font-size: 16px;
  line-height: 1.6;
}

.result-pane textarea::placeholder {
  color: var(--text-tertiary);
}

.toolbar {
  flex: 0 0 54px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 12px;
  min-height: 54px;
  padding: 8px 14px;
  background: var(--bg-surface);
}

.left-actions {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.right-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.tool-button,
.copy-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 10px;
  border-radius: 7px;
  white-space: nowrap;
  cursor: pointer;
}

.tool-button {
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 650;
}

.tool-button:hover:not(:disabled) {
  background: var(--bg-hover);
}

.copy-button {
  min-width: 104px;
  background: var(--primary-color);
  color: var(--text-white);
  font-size: 14px;
  font-weight: 700;
  box-shadow: 0 2px 7px var(--primary-shadow);
}

.copy-button:hover:not(:disabled) {
  background: var(--primary-hover);
}

.tool-button:disabled,
.copy-button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.icon,
.copy-icon {
  display: inline-grid;
  width: 18px;
  place-items: center;
  font-size: 18px;
  line-height: 1;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.toggle input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.switch {
  position: relative;
  width: 38px;
  height: 22px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: var(--switch-bg);
  transition: background 0.16s ease;
}

.switch::after {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--text-white);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.24);
  content: "";
  transition: transform 0.16s ease;
}

.toggle input:checked + .switch {
  background: var(--primary-color);
}

.toggle input:checked + .switch::after {
  transform: translateX(16px);
}

.file-input {
  display: none;
}

.toast {
  position: fixed;
  right: 18px;
  bottom: 66px;
  max-width: min(420px, calc(100vw - 36px));
  padding: 10px 14px;
  border-radius: 7px;
  background: var(--toast-bg);
  color: var(--toast-text);
  font-size: 13px;
  line-height: 1.4;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 760px) {
  .ocr-shell {
    grid-template-rows: minmax(0, 1fr) auto;
  }

  .workbench {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(220px, 44vh) minmax(220px, 1fr);
  }

  .preview-pane {
    border-right: 0;
    border-bottom: 1px solid var(--border-color);
  }

  .result-pane textarea {
    padding: 14px;
    font-size: 15px;
  }

  .toolbar {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .left-actions {
    justify-content: space-between;
    gap: 4px;
  }

  .right-actions {
    justify-content: space-between;
    gap: 8px;
  }

  .tool-button,
  .copy-button {
    min-height: 32px;
    padding: 0 8px;
    font-size: 13px;
  }

  .toggle {
    justify-content: center;
  }
}
</style>
