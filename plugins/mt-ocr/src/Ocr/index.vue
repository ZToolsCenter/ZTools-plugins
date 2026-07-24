<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { createCurrentService } from './services'
import {
  getDefaultConfig,
  VENDORS,
  type OcrConfig,
  type OcrResult,
  type VendorId
} from './types'

const props = defineProps({
  enterAction: { type: Object, default: () => ({}) }
})

const STORAGE_KEY = 'ocr-config'

// ========== 状态 ==========

const imageData = ref('')
const imageRawBase64 = ref('')
const result = ref<OcrResult | null>(null)
const recognizing = ref(false)
const errorMsg = ref('')
const showConfig = ref(false)
const showDropZone = ref(false)

const ocrConfig = ref<OcrConfig>(getDefaultConfig())
const editingConfig = ref<OcrConfig>(getDefaultConfig())
const activeConfigTab = ref<VendorId>('tencent')

// 立即加载配置（必须在 watch 之前，防止 enterAction 触发的自动识别在配置加载前执行）
loadConfig()

// ========== 计算属性 ==========

function hasCredentials(vendorId: VendorId): boolean {
  const cfg: any = ocrConfig.value.vendors[vendorId]
  switch (vendorId) {
    case 'tencent': return !!(cfg.secretId && cfg.secretKey)
    case 'baidu': return !!(cfg.apiKey && cfg.secretKey)
    case 'alibaba': return !!(cfg.accessKeyId && cfg.accessKeySecret)
    default: return false
  }
}

/** 可用厂商列表（已配置密钥的） */
const availableVendors = computed(() =>
  VENDORS.filter(v => hasCredentials(v.id))
)

const currentVendor = computed(() =>
  VENDORS.find(v => v.id === ocrConfig.value.selectedVendor) || VENDORS[0]
)

const hasImage = computed(() => !!imageData.value)
const resultText = computed(() => result.value?.text || '')
const noVendorConfigured = computed(() => availableVendors.value.length === 0)

// ========== 配置管理 ==========

function loadConfig() {
  try {
    const saved = window.ztools.dbStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      ocrConfig.value = mergeConfig(getDefaultConfig(), parsed)
    }
  } catch {
    ocrConfig.value = getDefaultConfig()
  }
}

function mergeConfig(defaultCfg: OcrConfig, saved: any): OcrConfig {
  return {
    selectedVendor: saved.selectedVendor || defaultCfg.selectedVendor,
    vendors: {
      tencent: { ...defaultCfg.vendors.tencent, ...(saved.vendors?.tencent || {}) },
      baidu: { ...defaultCfg.vendors.baidu, ...(saved.vendors?.baidu || {}) },
      alibaba: { ...defaultCfg.vendors.alibaba, ...(saved.vendors?.alibaba || {}) }
    }
  }
}

function saveConfig() {
  window.ztools.dbStorage.setItem(STORAGE_KEY, JSON.stringify(ocrConfig.value))
}

function openConfig() {
  editingConfig.value = JSON.parse(JSON.stringify(ocrConfig.value))
  activeConfigTab.value = ocrConfig.value.selectedVendor
  showConfig.value = true
}

function applyConfig() {
  ocrConfig.value = JSON.parse(JSON.stringify(editingConfig.value))
  saveConfig()
  showConfig.value = false
}

function cancelConfig() {
  showConfig.value = false
}

function resetConfig() {
  editingConfig.value = getDefaultConfig()
}

// ========== 导入 / 导出配置 ==========

function exportConfig() {
  const data = JSON.stringify(ocrConfig.value, null, 2)
  window.ztools.copyText(data)
  window.ztools.showNotification('配置已复制到剪贴板')
}

function importConfig() {
  navigator.clipboard.readText().then(text => {
    try {
      const parsed = JSON.parse(text)
      if (!parsed.vendors) {
        throw new Error('无效的配置文件格式')
      }
      editingConfig.value = mergeConfig(getDefaultConfig(), parsed)
    } catch (e: any) {
      window.ztools.showNotification('导入失败: ' + (e.message || '配置格式不正确'))
    }
  }).catch(() => {
    window.ztools.showNotification('读取剪贴板失败，请确保已复制配置内容')
  })
}

// ========== 图片获取 ==========

function handleScreenshot() {
  window.ztools.screenCapture((base64DataUrl) => {
    if (base64DataUrl) {
      setImage(base64DataUrl)
    }
  })
}

function handleOpenFile() {
  const files = window.ztools.showOpenDialog({
    title: '选择图片',
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'] }],
    properties: ['openFile']
  })
  if (!files || files.length === 0) return

  try {
    const base64DataUrl = window.services.readImageFile(files[0])
    setImage(base64DataUrl)
  } catch (e: any) {
    errorMsg.value = '读取图片失败: ' + (e.message || '')
  }
}

function setImage(dataUrl: string) {
  imageData.value = dataUrl
  const match = dataUrl.match(/^data:image\/\w+;base64,(.+)$/)
  imageRawBase64.value = match ? match[1] : dataUrl
  result.value = null
  errorMsg.value = ''
}

function clearImage() {
  imageData.value = ''
  imageRawBase64.value = ''
  result.value = null
  errorMsg.value = ''
  recognizing.value = false
}

// ========== 拖放处理 ==========

function onDragOver(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  showDropZone.value = true
}

function onDragLeave(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  showDropZone.value = false
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  showDropZone.value = false

  const file = e.dataTransfer?.files?.[0]
  if (!file || !file.type.startsWith('image/')) return

  const reader = new FileReader()
  reader.onload = () => {
    if (reader.result) {
      setImage(reader.result as string)
    }
  }
  reader.readAsDataURL(file)
}

// ========== 粘贴处理 ==========

function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.type.startsWith('image/')) {
      const blob = item.getAsFile()
      if (!blob) continue
      const reader = new FileReader()
      reader.onload = () => {
        if (reader.result) {
          setImage(reader.result as string)
        }
      }
      reader.readAsDataURL(blob)
      break
    }
  }
}

// ========== OCR 识别 ==========

async function handleRecognize() {
  const currentImage = imageRawBase64.value
  if (!currentImage) return

  if (noVendorConfigured.value) {
    errorMsg.value = '请先配置至少一个 OCR 服务的 API 密钥'
    return
  }

  recognizing.value = true
  errorMsg.value = ''
  result.value = null

  try {
    const service = createCurrentService({
      selectedVendor: ocrConfig.value.selectedVendor,
      vendors: ocrConfig.value.vendors
    })

    const res = await service.recognize(currentImage)
    if (imageRawBase64.value === currentImage) {
      result.value = res
    }
  } catch (e: any) {
    if (imageRawBase64.value === currentImage) {
      errorMsg.value = e.message || '识别失败'
    }
  } finally {
    if (imageRawBase64.value === currentImage) {
      recognizing.value = false
    }
  }
}

// ========== 结果操作 ==========

function handleCopyText() {
  if (resultText.value) {
    window.ztools.copyText(resultText.value)
    window.ztools.showNotification('已复制到剪贴板')
  }
}

function handleSaveText() {
  if (resultText.value) {
    try {
      const path = window.services.writeTextFile(resultText.value)
      if (path) window.ztools.shellShowItemInFolder(path)
    } catch (e: any) {
      window.ztools.showNotification('保存文本失败: ' + (e.message || ''))
    }
  }
}

function handleSaveImage() {
  if (imageData.value) {
    try {
      const path = window.services.writeImageFile(imageData.value)
      if (path) window.ztools.shellShowItemInFolder(path)
    } catch (e: any) {
      window.ztools.showNotification('保存图片失败: ' + (e.message || ''))
    }
  }
}

function handleTranslate() {
  if (resultText.value) {
    // 跳转到「易翻翻译」插件，传入识别文本
    // 备选 label: '翻译', '易翻翻译', 'fjyi'
    console.log('[OCR] redirect 参数:', '翻译', resultText.value)
    const ok = window.ztools.redirect('翻译', resultText.value)
    console.log('[OCR] redirect 结果:', ok)
    if (!ok) {
      window.ztools.showNotification('未找到易翻翻译插件，请确认已安装并启用')
    } else {
      window.ztools.showNotification('已跳转到易翻翻译')
    }
  }
}

// ========== 生命周期 ==========

onMounted(() => {
  loadConfig()
  document.addEventListener('paste', onPaste)
})

onUnmounted(() => {
  document.removeEventListener('paste', onPaste)
})

// 仅有一个可用厂商时自动选中
watch(availableVendors, (vendors) => {
  if (vendors.length === 0) return
  if (vendors.length === 1) {
    ocrConfig.value.selectedVendor = vendors[0].id
    saveConfig()
    return
  }
  // 当前选中不在可用列表中时，选第一个
  if (!vendors.find(v => v.id === ocrConfig.value.selectedVendor)) {
    ocrConfig.value.selectedVendor = vendors[0].id
    saveConfig()
  }
}, { immediate: true })

// 有图片后自动触发识别
watch(imageRawBase64, (val) => {
  if (val) {
    handleRecognize()
  }
})

// 当通过图片/文件匹配进入时，自动加载图片（setImage 会触发自动识别）
watch(
  () => props.enterAction,
  (action: any) => {
    if (!action || !action.type) return
    if (action.type === 'img') {
      if (action.payload) {
        setImage(action.payload)
      }
    } else if (action.type === 'files') {
      const file = action.payload?.[0]
      if (file?.path) {
        try {
          const base64DataUrl = window.services.readImageFile(file.path)
          setImage(base64DataUrl)
        } catch (e: any) {
          errorMsg.value = '读取图片失败: ' + (e.message || '')
        }
      }
    }
  },
  { immediate: true }
)
</script>

<template>
  <div
    class="ocr-app"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!-- 拖放遮罩 -->
    <div v-if="showDropZone" class="ocr-drop-overlay">
      <div class="ocr-drop-hint">
        <svg class="ocr-drop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="12" y1="18" x2="12" y2="12"/>
          <polyline points="9 15 12 12 15 15"/>
        </svg>
        <span>释放图片开始识别</span>
      </div>
    </div>

    <!-- 顶部工具栏 -->
    <div class="ocr-toolbar">
      <div class="ocr-toolbar-left">
        <button class="ocr-btn ocr-btn-primary" @click="handleScreenshot">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="ocr-btn-icon">
            <rect x="2" y="4" width="20" height="16" rx="2"/>
            <circle cx="12" cy="13" r="3"/>
            <path d="M8 4h8l1 2h3v12H4V6h3z"/>
          </svg>
          截图
        </button>
        <button class="ocr-btn" @click="handleOpenFile">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="ocr-btn-icon">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          打开
        </button>
      </div>

      <div class="ocr-toolbar-center">
        <!-- 未配置任何厂商 -->
        <div v-if="noVendorConfigured" class="ocr-no-vendor-hint">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="ocr-btn-icon">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>未配置 OCR 服务</span>
          <button class="ocr-btn ocr-btn-sm ocr-btn-primary" @click="openConfig">去配置</button>
        </div>
        <!-- 仅一个厂商：显示为徽章 -->
        <div v-else-if="availableVendors.length === 1" class="ocr-vendor-badge">
          <span class="ocr-vendor-dot"></span>
          {{ currentVendor.name }}
        </div>
        <!-- 多个厂商可选 -->
        <select
          v-else
          class="ocr-vendor-select"
          :value="ocrConfig.selectedVendor"
          @change="ocrConfig.selectedVendor = ($event.target as HTMLSelectElement).value as VendorId; saveConfig()"
        >
          <option v-for="v in availableVendors" :key="v.id" :value="v.id">
            {{ v.name }}
          </option>
        </select>
      </div>

      <div class="ocr-toolbar-right">
        <button
          class="ocr-btn ocr-btn-primary"
          :disabled="!hasImage || recognizing"
          @click="handleRecognize"
        >
          <svg v-if="recognizing" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="ocr-btn-icon ocr-spin">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 2a10 10 0 0 1 10 10"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="ocr-btn-icon">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          {{ recognizing ? '识别中...' : '识别' }}
        </button>
        <button class="ocr-btn ocr-btn-tool" @click="openConfig" title="配置">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="ocr-btn-icon">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- 主内容区 -->
    <div class="ocr-main">
      <!-- 左侧：图片区域 -->
      <div class="ocr-image-panel" :class="{ 'has-image': hasImage }">
        <template v-if="!hasImage">
          <div class="ocr-image-placeholder">
            <!-- 空状态图标：简洁的图片+扫描线 -->
            <svg class="ocr-placeholder-svg" viewBox="0 0 120 120" fill="none">
              <rect x="25" y="20" width="70" height="70" rx="8" stroke="currentColor" stroke-width="2.5" stroke-dasharray="8 4"/>
              <circle cx="50" cy="45" r="6" stroke="currentColor" stroke-width="2"/>
              <path d="M30 80l20-20 10 10 15-15 15 15" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
              <rect x="30" y="42" width="14" height="14" rx="3" stroke="currentColor" stroke-width="2"/>
              <!-- 扫描线 -->
              <line x1="25" y1="55" x2="95" y2="55" stroke="currentColor" stroke-width="2" opacity="0.4"/>
              <circle cx="60" cy="55" r="3" fill="currentColor" opacity="0.4"/>
            </svg>
            <div class="ocr-placeholder-text">点击「截图」或拖放图片到此处</div>
            <div class="ocr-placeholder-hint">支持截图 · 本地图片 · 剪贴板粘贴 · 拖放</div>
          </div>
        </template>
        <template v-else>
          <div class="ocr-image-wrapper">
            <img :src="imageData" class="ocr-image" alt="待识别图片" />
            <div v-if="recognizing" class="ocr-image-scanning">
              <div class="ocr-scan-line"></div>
            </div>
            <div class="ocr-image-actions">
              <button class="ocr-image-btn" @click="handleSaveImage" title="保存图片">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </button>
              <button class="ocr-image-btn ocr-image-btn-danger" @click="clearImage" title="清除图片">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>
        </template>
      </div>

      <!-- 分隔条 -->
      <div class="ocr-divider"></div>

      <!-- 右侧：结果区域 -->
      <div class="ocr-result-panel">
        <!-- 错误 -->
        <template v-if="errorMsg">
          <div class="ocr-error">
            <svg class="ocr-error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15"/>
              <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            <div class="ocr-error-text">{{ errorMsg }}</div>
          </div>
        </template>

        <!-- 空结果 -->
        <template v-if="!errorMsg && !result && !recognizing">
          <div class="ocr-result-placeholder">
            <svg class="ocr-placeholder-svg" viewBox="0 0 120 120" fill="none">
              <rect x="30" y="20" width="60" height="6" rx="3" fill="currentColor" opacity="0.15"/>
              <rect x="25" y="34" width="70" height="6" rx="3" fill="currentColor" opacity="0.15"/>
              <rect x="35" y="48" width="50" height="6" rx="3" fill="currentColor" opacity="0.12"/>
              <rect x="30" y="62" width="40" height="6" rx="3" fill="currentColor" opacity="0.1"/>
              <rect x="28" y="76" width="55" height="6" rx="3" fill="currentColor" opacity="0.08"/>
              <circle cx="60" cy="96" r="2" fill="currentColor" opacity="0.2"/>
              <circle cx="56" cy="96" r="1" fill="currentColor" opacity="0.15"/>
              <circle cx="64" cy="96" r="1" fill="currentColor" opacity="0.15"/>
            </svg>
            <div class="ocr-placeholder-text">识别结果将显示在这里</div>
          </div>
        </template>

        <!-- 识别中 -->
        <template v-if="recognizing">
          <div class="ocr-recognizing">
            <div class="ocr-recognizing-spinner"></div>
            <div class="ocr-recognizing-text">正在识别...</div>
          </div>
        </template>

        <!-- 结果 -->
        <template v-if="result">
          <div class="ocr-result-header">
            <span class="ocr-result-label">识别结果</span>
            <div class="ocr-result-actions">
              <button class="ocr-btn ocr-btn-sm" @click="handleCopyText">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="ocr-btn-icon">
                  <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                复制
              </button>
              <button class="ocr-btn ocr-btn-sm" @click="handleSaveText">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="ocr-btn-icon">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                保存
              </button>
              <button class="ocr-btn ocr-btn-sm ocr-btn-accent" @click="handleTranslate">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="ocr-btn-icon">
                  <path d="M5 8l2 5 2-5M13 8l2 5 2-5M7 11h6"/>
                  <circle cx="9" cy="17" r="4"/>
                  <path d="M9 17a4 4 0 0 0 8 0"/>
                  <line x1="12" y1="17" x2="12" y2="21"/>
                </svg>
                翻译
              </button>
            </div>
          </div>
          <textarea
            class="ocr-result-text"
            readonly
            :value="resultText"
          ></textarea>
        </template>
      </div>
    </div>

    <!-- 配置弹窗 -->
    <div v-if="showConfig" class="ocr-config-overlay" @click.self="cancelConfig">
      <div class="ocr-config-dialog">
        <!-- 标题栏 -->
        <div class="ocr-config-header">
          <div class="ocr-config-title">
            <svg class="ocr-config-title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            <h3>基本设置</h3>
          </div>
          <button class="ocr-config-close" @click="cancelConfig">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <!-- 主体：左右分栏 -->
        <div class="ocr-config-body">
          <!-- 左侧配置区 -->
          <div class="ocr-config-main">
            <!-- OCR 服务选择 -->
            <div class="ocr-config-row">
              <label class="ocr-config-row-label">OCR 服务</label>
              <div class="ocr-config-row-control">
                <label
                  v-for="v in VENDORS"
                  :key="v.id"
                  class="ocr-config-vendor-item"
                  :class="{ active: activeConfigTab === v.id }"
                >
                  <input
                    type="radio"
                    :value="v.id"
                    v-model="activeConfigTab"
                    class="ocr-config-radio"
                  />
                  <span class="ocr-config-vendor-name">{{ v.name }}</span>
                </label>
              </div>
            </div>

            <!-- 腾讯云表单 -->
            <template v-if="activeConfigTab === 'tencent'">
              <div class="ocr-config-row">
                <label class="ocr-config-row-label">SecretId</label>
                <div class="ocr-config-row-control">
                  <input
                    v-model="editingConfig.vendors.tencent.secretId"
                    class="ocr-config-input"
                    type="text"
                    placeholder="请输入腾讯云 SecretId"
                  />
                </div>
              </div>
              <div class="ocr-config-row">
                <label class="ocr-config-row-label">SecretKey</label>
                <div class="ocr-config-row-control">
                  <input
                    v-model="editingConfig.vendors.tencent.secretKey"
                    class="ocr-config-input"
                    type="password"
                    placeholder="请输入腾讯云 SecretKey"
                  />
                </div>
              </div>
              <div class="ocr-config-row">
                <label class="ocr-config-row-label">Region</label>
                <div class="ocr-config-row-control">
                  <input
                    v-model="editingConfig.vendors.tencent.region"
                    class="ocr-config-input"
                    type="text"
                    placeholder="ap-guangzhou"
                  />
                </div>
              </div>
            </template>

            <!-- 百度云表单 -->
            <template v-if="activeConfigTab === 'baidu'">
              <div class="ocr-config-row">
                <label class="ocr-config-row-label">API Key</label>
                <div class="ocr-config-row-control">
                  <input
                    v-model="editingConfig.vendors.baidu.apiKey"
                    class="ocr-config-input"
                    type="text"
                    placeholder="请输入百度云 API Key"
                  />
                </div>
              </div>
              <div class="ocr-config-row">
                <label class="ocr-config-row-label">Secret Key</label>
                <div class="ocr-config-row-control">
                  <input
                    v-model="editingConfig.vendors.baidu.secretKey"
                    class="ocr-config-input"
                    type="password"
                    placeholder="请输入百度云 Secret Key"
                  />
                </div>
              </div>
            </template>

            <!-- 阿里云表单 -->
            <template v-if="activeConfigTab === 'alibaba'">
              <div class="ocr-config-row">
                <label class="ocr-config-row-label">AccessKey ID</label>
                <div class="ocr-config-row-control">
                  <input
                    v-model="editingConfig.vendors.alibaba.accessKeyId"
                    class="ocr-config-input"
                    type="text"
                    placeholder="请输入阿里云 AccessKey ID"
                  />
                </div>
              </div>
              <div class="ocr-config-row">
                <label class="ocr-config-row-label">AccessKey Secret</label>
                <div class="ocr-config-row-control">
                  <input
                    v-model="editingConfig.vendors.alibaba.accessKeySecret"
                    class="ocr-config-input"
                    type="password"
                    placeholder="请输入阿里云 AccessKey Secret"
                  />
                </div>
              </div>
            </template>

            <!-- 导出/导入 -->
            <div class="ocr-config-row ocr-config-row-last">
              <label class="ocr-config-row-label"></label>
              <div class="ocr-config-row-control">
                <button class="ocr-btn" @click="exportConfig" title="将当前配置导出为 JSON 明文并复制到剪贴板">导出配置</button>
                <button class="ocr-btn" @click="importConfig" title="从剪贴板读取 JSON 明文配置并导入">导入配置</button>
              </div>
            </div>
          </div>

          <!-- 右侧说明区 -->
          <div class="ocr-config-sidebar">
            <div class="ocr-config-sidebar-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
              </svg>
              <span>选项说明</span>
            </div>
            <div class="ocr-config-sidebar-content">
              <template v-if="activeConfigTab === 'tencent'">
                <h4>腾讯云 OCR</h4>
                <p>腾讯云通用印刷体识别服务，支持中英文、数字及常见符号的识别。</p>
                <p>请前往腾讯云控制台获取 SecretId 和 SecretKey。</p>
                <p class="ocr-config-sidebar-hint">Region 默认 ap-guangzhou，可根据实际情况修改。</p>
              </template>
              <template v-if="activeConfigTab === 'baidu'">
                <h4>百度云 OCR</h4>
                <p>百度智能云文字识别服务，高精度识别各类文档、票据、卡片图片。</p>
                <p>请前往百度智能云控制台获取 API Key 和 Secret Key。</p>
              </template>
              <template v-if="activeConfigTab === 'alibaba'">
                <h4>阿里云 OCR</h4>
                <p>阿里云文档智能识别服务，支持多场景文字提取与结构化输出。</p>
                <p>请前往阿里云控制台获取 AccessKey ID 和 AccessKey Secret。</p>
              </template>
            </div>
          </div>
        </div>

        <!-- 底部操作栏 -->
        <div class="ocr-config-footer">
          <button class="ocr-btn ocr-btn-danger-text" @click="resetConfig">重置配置</button>
          <div class="ocr-config-actions">
            <button class="ocr-btn" @click="cancelConfig">取消</button>
            <button class="ocr-btn ocr-btn-primary" @click="applyConfig">确定</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ========== 整体布局 ========== */
.ocr-app {
  --primary: #5B6AF0;
  --primary-hover: #4A56D4;
  --primary-bg: rgba(91, 106, 240, 0.06);
  --primary-border: rgba(91, 106, 240, 0.2);
  --accent: #0EA882;
  --accent-hover: #0B8F6E;
  --danger: #E5484D;
  --danger-bg: rgba(229, 72, 77, 0.06);
  --bg-base: #F9F9FB;
  --bg-surface: #FFFFFF;
  --bg-subtle: #F3F3F6;
  --bg-muted: #ECECF0;
  --border-default: #E4E4E9;
  --border-strong: #D4D4DC;
  --text-primary: #1A1A2E;
  --text-secondary: #6B6B80;
  --text-tertiary: #9C9CB0;
  --text-placeholder: #BEBECC;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.08);
  --shadow-lg: 0 12px 40px rgba(0, 0, 0, 0.12);
  --shadow-glow: 0 0 0 3px rgba(91, 106, 240, 0.15);
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --font-stack: 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'PingFang SC', 'Microsoft YaHei', sans-serif;

  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  position: relative;
  user-select: none;
  font-family: var(--font-stack);
  background: var(--bg-base);
  color: var(--text-primary);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* ========== 拖放遮罩 ========== */
.ocr-drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 100;
  background: rgba(91, 106, 240, 0.08);
  backdrop-filter: blur(2px);
  border: 2px dashed var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  border-radius: 0;
  animation: dropPulse 2s ease-in-out infinite;
}
@keyframes dropPulse {
  0%, 100% { border-color: var(--primary); background: rgba(91, 106, 240, 0.04); }
  50% { border-color: rgba(91, 106, 240, 0.6); background: rgba(91, 106, 240, 0.1); }
}
.ocr-drop-hint {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  font-weight: 600;
  color: var(--primary);
  background: var(--bg-surface);
  padding: 14px 28px;
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg), 0 0 0 1px rgba(91, 106, 240, 0.08);
}
.ocr-drop-icon {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
}

/* ========== 工具栏 ========== */
.ocr-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border-default);
  gap: 12px;
  flex-shrink: 0;
  background: var(--bg-surface);
  box-shadow: var(--shadow-sm);
  position: relative;
  z-index: 10;
}
.ocr-toolbar-left,
.ocr-toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ocr-toolbar-center {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
}

/* ========== 按钮 ========== */
.ocr-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
  white-space: nowrap;
  line-height: 1.5;
  font-weight: 500;
  letter-spacing: -0.01em;
  position: relative;
  overflow: hidden;
}
.ocr-btn::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--primary);
  opacity: 0;
  transition: opacity 0.18s;
  pointer-events: none;
}
.ocr-btn:hover:not(:disabled) {
  border-color: var(--primary-border);
  background: var(--primary-bg);
  color: var(--primary);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(91, 106, 240, 0.1);
}
.ocr-btn:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: none;
}
.ocr-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.ocr-btn-primary {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(91, 106, 240, 0.25), 0 0 0 1px rgba(91, 106, 240, 0.1);
}
.ocr-btn-primary::after {
  background: rgba(255, 255, 255, 0.15);
}
.ocr-btn-primary:hover:not(:disabled) {
  background: var(--primary-hover);
  border-color: var(--primary-hover);
  color: #fff;
  box-shadow: 0 4px 14px rgba(91, 106, 240, 0.35);
  transform: translateY(-1px);
}
.ocr-btn-primary:active:not(:disabled) {
  background: #3E44C8;
  transform: translateY(0);
  box-shadow: 0 1px 3px rgba(91, 106, 240, 0.25);
}
.ocr-btn-accent {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(14, 168, 130, 0.25);
}
.ocr-btn-accent:hover:not(:disabled) {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
  color: #fff;
  box-shadow: 0 4px 14px rgba(14, 168, 130, 0.35);
  transform: translateY(-1px);
}
.ocr-btn-tool {
  padding: 7px 9px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
}
.ocr-btn-tool:hover {
  border-color: var(--primary-border);
  background: var(--primary-bg);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(91, 106, 240, 0.08);
}
.ocr-btn-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.ocr-btn-sm {
  padding: 4px 10px;
  font-size: 12px;
  gap: 4px;
  border-radius: var(--radius-sm);
}
.ocr-btn-sm .ocr-btn-icon {
  width: 13px;
  height: 13px;
}

/* 识别中转动动画 */
.ocr-spin {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ========== 厂商指示 ========== */
.ocr-no-vendor-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-tertiary);
}
.ocr-no-vendor-hint svg {
  width: 15px;
  height: 15px;
}

.ocr-vendor-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-primary);
  padding: 5px 14px;
  border-radius: 20px;
  background: var(--bg-subtle);
  border: 1px solid var(--border-default);
  box-shadow: var(--shadow-sm);
}
.ocr-vendor-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--primary);
  box-shadow: 0 0 6px rgba(91, 106, 240, 0.4);
}

.ocr-vendor-select {
  padding: 6px 14px;
  padding-right: 28px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  outline: none;
  appearance: none;
  letter-spacing: -0.01em;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239C9CB0' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
}
.ocr-vendor-select:hover {
  border-color: var(--primary-border);
}
.ocr-vendor-select:focus {
  border-color: var(--primary);
  box-shadow: var(--shadow-glow);
}

/* ========== 主内容区 ========== */
.ocr-main {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
  background: var(--bg-base);
}
.ocr-divider {
  width: 1px;
  background: var(--border-default);
  flex-shrink: 0;
  position: relative;
}

/* ========== 图片面板 ========== */
.ocr-image-panel {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-subtle);
  overflow: hidden;
  position: relative;
  min-width: 0;
  background-image:
    radial-gradient(circle at 20% 30%, rgba(91, 106, 240, 0.03) 0%, transparent 50%),
    radial-gradient(circle at 80% 70%, rgba(14, 168, 130, 0.03) 0%, transparent 50%);
}
.ocr-image-panel.has-image {
  background: var(--bg-muted);
  background-image: none;
}
.ocr-image-placeholder {
  text-align: center;
  padding: 32px;
}
.ocr-placeholder-svg {
  width: 80px;
  height: 80px;
  margin: 0 auto 20px;
  color: var(--text-tertiary);
  opacity: 0.5;
}
.ocr-placeholder-text {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 8px;
  font-weight: 500;
  letter-spacing: -0.01em;
}
.ocr-placeholder-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  letter-spacing: -0.01em;
}

.ocr-image-wrapper {
  position: relative;
  max-width: 100%;
  max-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ocr-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
  border-radius: 4px;
  box-shadow: var(--shadow-lg);
}
/* 图片右下角操作按钮组 */
.ocr-image-actions {
  position: absolute;
  bottom: 8px;
  right: 8px;
  display: flex;
  gap: 5px;
  opacity: 0;
  transform: translateY(4px);
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.ocr-image-wrapper:hover .ocr-image-actions {
  opacity: 1;
  transform: translateY(0);
}
.ocr-image-btn {
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  border: none;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
  padding: 0;
}
.ocr-image-btn svg {
  width: 15px;
  height: 15px;
}
.ocr-image-btn:hover {
  background: rgba(0, 0, 0, 0.75);
  transform: scale(1.08);
}
.ocr-image-btn-danger:hover {
  background: rgba(229, 72, 77, 0.85);
}

/* 扫描线动画 */
.ocr-image-scanning {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}
.ocr-scan-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--primary), transparent);
  box-shadow: 0 0 12px rgba(91, 106, 240, 0.5);
  animation: scanDown 2s ease-in-out infinite;
}
@keyframes scanDown {
  0% { top: 0; opacity: 0; }
  20% { opacity: 1; }
  80% { opacity: 1; }
  100% { top: 100%; opacity: 0; }
}

/* ========== 结果面板 ========== */
.ocr-result-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  background: var(--bg-surface);
}
.ocr-result-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.ocr-error {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  margin: 12px;
  background: var(--danger-bg);
  border: 1px solid rgba(229, 72, 77, 0.2);
  border-radius: var(--radius-md);
  color: var(--danger);
}
.ocr-error-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  margin-top: 1px;
}
.ocr-error-text {
  font-size: 13px;
  line-height: 1.5;
  word-break: break-all;
}
.ocr-recognizing {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
}
.ocr-recognizing-spinner {
  width: 32px;
  height: 32px;
  border: 2.5px solid var(--border-strong);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
.ocr-recognizing-text {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
  letter-spacing: -0.01em;
}
.ocr-result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
  background: var(--bg-subtle);
}
.ocr-result-label {
  font-size: 11px;
  color: var(--text-tertiary);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.ocr-result-actions {
  display: flex;
  gap: 5px;
}
.ocr-result-text {
  flex: 1;
  width: 100%;
  border: none;
  background: transparent;
  padding: 16px;
  font-size: 14px;
  line-height: 1.8;
  color: var(--text-primary);
  resize: none;
  outline: none;
  font-family: inherit;
  letter-spacing: -0.01em;
}

/* ========== 配置弹窗 ========== */
.ocr-config-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: overlayIn 0.2s ease;
}
@keyframes overlayIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
.ocr-config-dialog {
  background: var(--bg-surface);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg), 0 0 0 1px rgba(0, 0, 0, 0.04);
  width: 720px;
  max-width: 92vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: dialogIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes dialogIn {
  from { transform: scale(0.96) translateY(8px); opacity: 0; }
  to { transform: scale(1) translateY(0); opacity: 1; }
}

/* 标题栏 */
.ocr-config-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}
.ocr-config-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ocr-config-title h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}
.ocr-config-title-icon {
  width: 18px;
  height: 18px;
  color: var(--primary);
  flex-shrink: 0;
}
.ocr-config-close {
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  padding: 0;
}
.ocr-config-close svg {
  width: 16px;
  height: 16px;
}
.ocr-config-close:hover {
  background: var(--bg-muted);
  color: var(--text-primary);
}

/* 主体 */
.ocr-config-body {
  display: flex;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

/* 左侧主区域 */
.ocr-config-main {
  flex: 1;
  padding: 20px 24px;
  overflow-y: auto;
  min-width: 0;
}

/* 配置行 */
.ocr-config-row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}
.ocr-config-row-label {
  width: 100px;
  flex-shrink: 0;
  text-align: right;
  font-size: 12.5px;
  color: var(--text-secondary);
  font-weight: 500;
  letter-spacing: -0.01em;
}
.ocr-config-row-control {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.ocr-config-row-last {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--border-default);
}

/* 厂商单选 */
.ocr-config-vendor-item {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-default);
  background: var(--bg-surface);
  cursor: pointer;
  transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}
.ocr-config-vendor-item:hover {
  border-color: var(--primary-border);
  background: var(--primary-bg);
}
.ocr-config-vendor-item.active {
  border-color: var(--primary);
  background: var(--primary-bg);
  color: var(--primary);
  box-shadow: 0 0 0 2px rgba(91, 106, 240, 0.1);
}
.ocr-config-radio {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--primary);
  cursor: pointer;
}

/* 输入框 */
.ocr-config-input {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  font-size: 13px;
  outline: none;
  background: var(--bg-surface);
  color: var(--text-primary);
  transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
  letter-spacing: -0.01em;
}
.ocr-config-input:hover {
  border-color: var(--border-strong);
}
.ocr-config-input:focus {
  border-color: var(--primary);
  box-shadow: var(--shadow-glow);
}
.ocr-config-input::placeholder {
  color: var(--text-placeholder);
}

/* 右侧说明 */
.ocr-config-sidebar {
  width: 220px;
  flex-shrink: 0;
  border-left: 1px solid var(--border-default);
  background: var(--bg-subtle);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ocr-config-sidebar-header {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 14px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-default);
  letter-spacing: -0.01em;
}
.ocr-config-sidebar-header svg {
  width: 16px;
  height: 16px;
  color: var(--primary);
}
.ocr-config-sidebar-content {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-secondary);
}
.ocr-config-sidebar-content h4 {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}
.ocr-config-sidebar-content p {
  margin: 0 0 10px;
}
.ocr-config-sidebar-hint {
  color: var(--text-tertiary);
  font-size: 11px;
  padding: 8px 10px;
  background: var(--primary-bg);
  border-radius: var(--radius-sm);
  border-left: 3px solid var(--primary);
  margin-top: 4px;
}

/* 底部 */
.ocr-config-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-top: 1px solid var(--border-default);
  background: var(--bg-subtle);
  flex-shrink: 0;
}
.ocr-config-actions {
  display: flex;
  gap: 8px;
}
.ocr-btn-danger-text {
  color: var(--danger);
  border-color: transparent;
  background: transparent;
  font-weight: 500;
}
.ocr-btn-danger-text:hover {
  background: var(--danger-bg);
  border-color: rgba(229, 72, 77, 0.2);
  color: var(--danger);
  box-shadow: none;
  transform: none;
}

/* ========== 深色主题 ========== */
@media (prefers-color-scheme: dark) {
  .ocr-app {
    --bg-base: #111114;
    --bg-surface: #1A1A1F;
    --bg-subtle: #151518;
    --bg-muted: #202025;
    --primary-bg: rgba(110, 126, 255, 0.08);
    --primary-border: rgba(110, 126, 255, 0.25);
    --border-default: #2A2A32;
    --border-strong: #383842;
    --text-primary: #EAEAF0;
    --text-secondary: #8B8B9E;
    --text-tertiary: #5C5C6E;
    --text-placeholder: #4A4A58;
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
    --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.4);
    --shadow-lg: 0 12px 40px rgba(0, 0, 0, 0.5);
    --shadow-glow: 0 0 0 3px rgba(110, 126, 255, 0.2);
    --danger-bg: rgba(229, 72, 77, 0.1);
  }
  .ocr-placeholder-svg > * {
    stroke-opacity: 0.3;
  }
  .ocr-image-panel.has-image {
    background: #0E0E10;
  }
}
</style>
