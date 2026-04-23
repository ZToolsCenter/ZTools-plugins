<script lang="ts" setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Upload, Camera, DocumentCopy, Download, Refresh } from '@element-plus/icons-vue'
import QRCode from 'qrcode'
import jsQR from 'jsqr'

const mode = ref<'generate' | 'decode'>('generate')

// 生成模式
const inputText = ref('')
const qrDataUrl = ref('')
const qrSize = ref(200)

// 解码模式
const decodeImageSrc = ref('')
const decodeResult = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)

// 隐藏的 canvas 用于解码
const decodeCanvasRef = ref<HTMLCanvasElement | null>(null)

// 是否在 ZTools 环境
const isZToolsEnv = ref(false)

onMounted(() => {
  isZToolsEnv.value = Boolean((window as any).ztools?.screenCapture)
  // 监听粘贴事件
  document.addEventListener('paste', handlePaste)
})

onUnmounted(() => {
  document.removeEventListener('paste', handlePaste)
})

function copyText(text: string) {
  const doCopy = (window as any).ztools?.copyText
    ? Promise.resolve((window as any).ztools.copyText(text))
    : navigator.clipboard.writeText(text)
  doCopy
    .then(() => ElMessage.success({ message: '已复制到剪贴板', duration: 800 }))
    .catch(() => ElMessage.error({ message: '复制失败', duration: 1000 }))
}

function copyImage() {
  if (!qrDataUrl.value) return
  if ((window as any).ztools?.copyImage) {
    (window as any).ztools.copyImage(qrDataUrl.value)
    ElMessage.success({ message: '图片已复制到剪贴板', duration: 800 })
  } else {
    // 浏览器环境下尝试复制图片
    copyImageToClipboard(qrDataUrl.value)
  }
}

async function copyImageToClipboard(dataUrl: string) {
  try {
    // 直接从 base64 创建 Blob，避免 fetch 开销
    const base64 = dataUrl.split(',')[1]
    const mime = dataUrl.match(/^data:(image\/\w+);/)?.[1] || 'image/png'
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    const blob = new Blob([bytes], { type: mime })
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
    ElMessage.success({ message: '图片已复制到剪贴板', duration: 800 })
  } catch {
    ElMessage.warning({ message: '当前浏览器不支持复制图片', duration: 1000 })
  }
}

function downloadQR() {
  if (!qrDataUrl.value) return
  const a = document.createElement('a')
  a.href = qrDataUrl.value
  a.download = 'qrcode.png'
  a.click()
}

async function generateQR() {
  if (!inputText.value.trim()) {
    ElMessage.warning('请输入内容')
    return
  }
  try {
    qrDataUrl.value = await QRCode.toDataURL(inputText.value, {
      width: qrSize.value,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    })
  } catch (e: any) {
    ElMessage.error('生成失败: ' + e.message)
  }
}

// === 解码功能 ===

function handleFileSelect(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  loadImageFile(file)
}

function loadImageFile(file: File) {
  const reader = new FileReader()
  reader.onload = (e) => {
    decodeImageSrc.value = e.target?.result as string
    decodeQR()
  }
  reader.onerror = () => {
    ElMessage.error('读取文件失败')
  }
  reader.readAsDataURL(file)
}

function openFileDialog() {
  if ((window as any).ztools?.showOpenDialog) {
    const result = (window as any).ztools.showOpenDialog({
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }],
      properties: ['openFile']
    })
    if (result && result[0]) {
      // ZTools 返回文件路径，需要通过 preload 读取
      const services = (window as any).services
      if (services?.readFile) {
        services.readFile(result[0]).then((base64: string) => {
          decodeImageSrc.value = base64
          decodeQR()
        })
      } else {
        // 降级：使用原生 input
        fileInputRef.value?.click()
      }
    }
  } else {
    fileInputRef.value?.click()
  }
}

function screenCapture() {
  if (!(window as any).ztools?.screenCapture) {
    ElMessage.warning('请在 ZTools 环境中使用截图功能')
    return
  }
  (window as any).ztools.screenCapture((imgBase64: string) => {
    if (imgBase64) {
      decodeImageSrc.value = imgBase64
      decodeQR()
    }
  })
}

function handlePaste(event: ClipboardEvent) {
  if (mode.value !== 'decode') return
  const items = event.clipboardData?.items
  if (!items) return

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) {
        loadImageFile(file)
        return
      }
    }
  }
  ElMessage.warning('剪贴板中没有图片')
}

function decodeQR() {
  if (!decodeImageSrc.value) return

  const img = new Image()
  img.onload = () => {
    const canvas = decodeCanvasRef.value
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 限制最大尺寸，避免大图卡顿
    const maxSize = 800
    let width = img.width
    let height = img.height
    if (width > maxSize || height > maxSize) {
      const scale = maxSize / Math.max(width, height)
      width = Math.floor(width * scale)
      height = Math.floor(height * scale)
    }

    canvas.width = width
    canvas.height = height
    ctx.drawImage(img, 0, 0, width, height)

    const imageData = ctx.getImageData(0, 0, width, height)
    const code = jsQR(imageData.data, imageData.width, imageData.height)

    if (code) {
      decodeResult.value = code.data
    } else {
      decodeResult.value = ''
      ElMessage.warning('未检测到二维码')
    }
  }
  img.onerror = () => {
    ElMessage.error('加载图片失败')
  }
  img.src = decodeImageSrc.value
}

function clearDecode() {
  decodeImageSrc.value = ''
  decodeResult.value = ''
}
</script>

<template>
  <div class="qrcode-tool">
    <h2>二维码工具</h2>
    <p class="desc">生成二维码或将二维码图片解码为文字内容</p>

    <!-- 模式切换 -->
    <div class="mode-switch">
      <el-radio-group v-model="mode" size="small">
        <el-radio-button value="generate">生成二维码</el-radio-button>
        <el-radio-button value="decode">解码二维码</el-radio-button>
      </el-radio-group>
    </div>

    <!-- 生成模式 -->
    <div v-if="mode === 'generate'" class="generate-section">
      <div class="input-row">
        <el-input
          v-model="inputText"
          type="textarea"
          :rows="3"
          placeholder="输入文字、链接等内容（建议不超过500字符）"
          resize="none"
        />
        <div class="input-hint">
          <span>当前 {{ inputText.length }} 字符</span>
          <span v-if="inputText.length > 500" class="warn">· 内容过长可能导致生成失败</span>
        </div>
      </div>

      <div class="config-row">
        <label class="config-label">尺寸</label>
        <el-slider v-model="qrSize" :min="100" :max="400" :step="20" show-input :show-input-controls="false" />
      </div>

      <div class="action-row">
        <el-button type="primary" size="small" @click="generateQR">生成</el-button>
      </div>

      <div v-if="qrDataUrl" class="qr-preview">
        <img :src="qrDataUrl" alt="QR Code" />
        <div class="preview-actions">
          <el-button type="primary" size="small" :icon="DocumentCopy" @click="copyImage">复制图片</el-button>
          <el-button size="small" :icon="Download" @click="downloadQR">下载图片</el-button>
        </div>
      </div>
    </div>

    <!-- 解码模式 -->
    <div v-if="mode === 'decode'" class="decode-section">
      <div class="decode-actions">
        <el-button type="primary" size="small" :icon="Upload" @click="openFileDialog">选择文件</el-button>
        <el-button
          size="small"
          :icon="Camera"
          :disabled="!isZToolsEnv"
          @click="screenCapture"
        >
          屏幕截图
        </el-button>
        <span class="paste-hint">或直接 Ctrl+V 粘贴图片</span>
        <input
          ref="fileInputRef"
          type="file"
          accept="image/*"
          style="display: none"
          @change="handleFileSelect"
        />
      </div>

      <div v-if="decodeImageSrc" class="decode-preview">
        <img :src="decodeImageSrc" alt="待解码图片" />
        <el-button type="danger" size="small" :icon="Refresh" link @click="clearDecode">清除</el-button>
      </div>

      <div v-if="decodeResult" class="decode-result">
        <div class="result-header">
          <span>解码结果</span>
          <el-button type="primary" link size="small" @click="copyText(decodeResult)">复制</el-button>
        </div>
        <div class="result-content">{{ decodeResult }}</div>
      </div>

      <!-- 隐藏的 canvas 用于解码 -->
      <canvas ref="decodeCanvasRef" style="display: none"></canvas>
    </div>
  </div>
</template>

<style scoped>
.qrcode-tool {
  padding: 12px;
  max-width: 500px;
  margin: 0 auto;
  font-size: 13px;
}

h2 {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 600;
}

.desc {
  color: #909399;
  margin: 0 0 16px;
  font-size: 13px;
}

.mode-switch {
  margin-bottom: 16px;
}

.generate-section,
.decode-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.input-row {
  width: 100%;
}

.input-hint {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
}

.input-hint .warn {
  color: #e6a23c;
}

.config-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.config-label {
  width: 50px;
  flex-shrink: 0;
  font-weight: 500;
  color: #606266;
}

.config-row .el-slider {
  flex: 1;
}

.action-row {
  display: flex;
  justify-content: flex-start;
}

.qr-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: #f5f7fa;
  border-radius: 8px;
}

.qr-preview img {
  max-width: 100%;
  border-radius: 4px;
}

.preview-actions {
  display: flex;
  gap: 8px;
}

.decode-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.paste-hint {
  color: #909399;
  font-size: 12px;
}

.decode-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: #f5f7fa;
  border-radius: 8px;
}

.decode-preview img {
  max-width: 100%;
  max-height: 300px;
  border-radius: 4px;
}

.decode-result {
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  padding: 12px;
  background: #fafafa;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
  color: #909399;
}

.result-content {
  font-family: Consolas, 'Courier New', monospace;
  word-break: break-all;
  font-size: 13px;
  color: #667eea;
  line-height: 1.5;
}

@media (prefers-color-scheme: dark) {
  h2 {
    color: #e0e0e0;
  }

  .desc {
    color: #8a8a8a;
  }

  .config-label {
    color: #b0b0b0;
  }

  .input-hint {
    color: #666;
  }

  .input-hint .warn {
    color: #e6a23c;
  }

  .qr-preview,
  .decode-preview {
    background: #2c2c2c;
  }

  .decode-result {
    border-color: #414243;
    background: #2b2b2b;
  }

  .result-content {
    color: #8ba4f7;
  }

  .paste-hint {
    color: #666;
  }
}
</style>