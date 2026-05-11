<template>
  <CaptureEditor v-if="isEditorRoute" />
  <main v-else class="capture-app">
    <section class="preview-pane" @dragover.prevent @drop.prevent="onDrop">
      <div v-if="!imageSrc" class="empty-state">
        <div class="empty-icon">⌗</div>
        <div class="empty-title">截图工具</div>
        <div class="empty-subtitle">开始截图，或拖入图片预览后复制、保存</div>
      </div>
      <img v-else class="preview-image" :src="imageSrc" alt="截图预览">
      <div v-if="busy" class="busy-mask">
        <span v-if="busy" class="spinner"></span>
        <span>{{ statusText }}</span>
      </div>
    </section>

    <footer class="toolbar">
      <div class="left-actions">
        <button class="tool-button" type="button" :disabled="busy" @click="captureNow()">
          <span class="icon">⌗</span>
          <span>截图</span>
        </button>
      </div>

      <div class="meta">
        <span v-if="imageInfoText">{{ imageInfoText }}</span>
        <span v-else>支持 png、jpg、webp、bmp、gif</span>
      </div>

      <div class="right-actions">
        <button class="tool-button" type="button" :disabled="busy || !imageSrc" @click="clearImage">
          <span class="icon">×</span>
          <span>清空</span>
        </button>
        <button class="tool-button" type="button" :disabled="busy || !imageSrc" @click="saveImage">
          <span class="icon">⇩</span>
          <span>保存</span>
        </button>
        <button class="primary-button" type="button" :disabled="busy || !imageSrc" @click="copyImage">
          <span class="icon">⧉</span>
          <span>复制</span>
        </button>
      </div>
    </footer>

    <input ref="fileInput" class="file-input" type="file" accept="image/*" @change="onFileSelected">
    <div v-if="toastMessage" class="toast">{{ toastMessage }}</div>
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import CaptureEditor from './components/CaptureEditor.vue'

const CODE_CAPTURE = 'shortcut-capture'
const CODE_CAPTURE_COPY = 'shortcut-capture-copy'
const CODE_CAPTURE_SAVE = 'shortcut-capture-save'

const fileInput = ref(null)
const imageSrc = ref('')
const imageMeta = ref(null)
const busy = ref(false)
const statusText = ref('准备截图')
const toastMessage = ref('')
const isEditorRoute = ref(window.location.hash.startsWith('#/editor'))

let toastTimer = 0
let pendingAutoAction = ''

const imageInfoText = computed(() => {
  if (!imageMeta.value) return ''
  const size = formatBytes(imageMeta.value.bytes)
  return `${imageMeta.value.width} × ${imageMeta.value.height} · ${size}`
})

function showToast(message) {
  toastMessage.value = message
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toastMessage.value = ''
  }, 1800)
}

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatError(error) {
  return error && error.message ? error.message : String(error || '操作失败')
}

function updateImage(dataUrl) {
  imageSrc.value = dataUrl
  try {
    imageMeta.value = window.shortcutCapture?.imageInfo?.(dataUrl) || null
  } catch (_) {
    imageMeta.value = null
  }
}

function clearImage() {
  imageSrc.value = ''
  imageMeta.value = null
  pendingAutoAction = ''
  statusText.value = '准备截图'
}

function captureNow(autoAction = '') {
  if (busy.value) return
  pendingAutoAction = autoAction
  statusText.value = autoAction === 'copy' ? '截图后复制' : autoAction === 'save' ? '截图后保存' : '选择截图区域'
  busy.value = true
  try {
    if (!window.ztools?.screenCapture) {
      throw new Error('当前环境不支持截图')
    }
    window.ztools.screenCapture(async (image) => {
      try {
        if (!image) {
          busy.value = false
          statusText.value = '已取消截图'
          return
        }
        updateImage(image)
        busy.value = false
        statusText.value = '截图完成'
        if (pendingAutoAction === 'copy') {
          await copyImage()
        } else if (pendingAutoAction === 'save') {
          await saveImage()
        }
      } finally {
        pendingAutoAction = ''
        window.shortcutCapture?.outPlugin?.(true)
      }
    })
  } catch (error) {
    busy.value = false
    pendingAutoAction = ''
    showToast(formatError(error))
  }
}

async function copyImage() {
  if (!imageSrc.value) return
  try {
    if (window.ztools?.copyImage) {
      window.ztools.copyImage(imageSrc.value)
    } else {
      window.shortcutCapture.copyImage(imageSrc.value)
    }
    showToast('已复制截图')
  } catch (error) {
    showToast(formatError(error))
  }
}

function defaultSavePath() {
  const filename = window.shortcutCapture?.defaultFileName?.() || `screenshot-${Date.now()}.png`
  try {
    const downloads = window.ztools?.getPath?.('downloads')
    if (downloads) return `${downloads}/${filename}`
  } catch (_) {
    // Ignore unavailable host path API.
  }
  return filename
}

async function saveImage() {
  if (!imageSrc.value) return
  try {
    const result = window.ztools?.showSaveDialog?.({
      title: '保存截图',
      defaultPath: defaultSavePath(),
      buttonLabel: '保存',
      filters: [{ name: 'Images', extensions: ['png'] }]
    })
    const savePath = Array.isArray(result) ? result[0] : result?.filePath || result
    if (!savePath) return
    const path = window.shortcutCapture.saveDataUrl(imageSrc.value, savePath)
    showToast('已保存截图')
    try {
      window.ztools?.shellShowItemInFolder?.(path)
    } catch (_) {
      // Ignore unavailable shell API.
    }
  } catch (error) {
    showToast(formatError(error))
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

async function handleFile(file) {
  if (!file) return
  try {
    const filePath = window.ztools?.getPathForFile ? window.ztools.getPathForFile(file) : ''
    const dataUrl = filePath && window.shortcutCapture?.readImageDataUrl
      ? window.shortcutCapture.readImageDataUrl(filePath)
      : await readFileAsDataUrl(file)
    updateImage(dataUrl)
    statusText.value = '图片已载入'
  } catch (error) {
    showToast(formatError(error))
  }
}

function onFileSelected(event) {
  const file = event.target.files && event.target.files[0]
  handleFile(file)
  event.target.value = ''
}

function onDrop(event) {
  const file = event.dataTransfer?.files?.[0]
  handleFile(file)
}

async function consumeAction(action) {
  const code = action?.code
  if (code === CODE_CAPTURE_COPY) {
    captureNow('copy')
    return
  }
  if (code === CODE_CAPTURE_SAVE) {
    captureNow('save')
    return
  }
  const image = window.shortcutCapture?.getImageFromAction?.(action)
  if (image) {
    const dataUrl = image.startsWith('data:image/')
      ? image
      : window.shortcutCapture.readImageDataUrl(image)
    updateImage(dataUrl)
    statusText.value = '图片已载入'
    return
  }
  if (code === CODE_CAPTURE || !code) {
    captureNow()
  }
}

onMounted(() => {
  if (isEditorRoute.value) return
  try {
    window.ztools?.onPluginEnter?.(consumeAction)
  } catch (_) {
    // Ignore host API failures.
  }
})

onBeforeUnmount(() => {
  window.clearTimeout(toastTimer)
})
</script>

<style scoped>
.capture-app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--bg-app);
  color: var(--text-primary);
}

.preview-pane {
  position: relative;
  display: grid;
  flex: 1;
  min-height: 360px;
  place-items: center;
  overflow: hidden;
  background: var(--bg-panel-muted);
  border-bottom: 1px solid var(--border-color);
}

.empty-state {
  display: grid;
  gap: 8px;
  place-items: center;
  color: var(--text-secondary);
  text-align: center;
}

.empty-icon {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  color: var(--text-secondary);
  font-size: 26px;
}

.empty-title {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 650;
}

.empty-subtitle,
.meta {
  color: var(--text-tertiary);
  font-size: 12px;
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
  text-align: center;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
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

.toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 8px 14px;
  background: var(--bg-surface);
}

.left-actions,
.right-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.right-actions {
  justify-content: flex-end;
}

.tool-button,
.primary-button {
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

.primary-button {
  min-width: 86px;
  background: var(--primary-color);
  color: var(--text-white);
  font-size: 14px;
  font-weight: 700;
  box-shadow: 0 2px 7px var(--primary-shadow);
}

.primary-button:hover:not(:disabled) {
  background: var(--primary-hover);
}

.tool-button:disabled,
.primary-button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.icon {
  display: inline-grid;
  width: 18px;
  place-items: center;
  font-size: 18px;
  line-height: 1;
}

.file-input {
  display: none;
}

.toast {
  position: fixed;
  right: 18px;
  bottom: 68px;
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
  .toolbar {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .left-actions,
  .right-actions {
    justify-content: space-between;
  }
}
</style>
