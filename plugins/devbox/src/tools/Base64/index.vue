<script lang="ts" setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'

type Direction = 'encode' | 'decode'
type Variant = 'standard' | 'urlsafe'

interface FileInfo {
  name: string
  size: number
  type: string
  dataUrl: string
}

interface Result {
  ok: boolean
  /** 完整结果（复制 / 下载用） */
  value: string
  /** 截断后的展示内容 */
  display: string
  truncated: boolean
  imageUrl: string
  mime: string
  bytes: Uint8Array | null
  error: string
  note: string
  meta: string
}

const MAX_DISPLAY = 8000
const MAX_FILE = 20 * 1024 * 1024
const MAX_FILL = 200000
const CHUNK = 0x8000

const direction = ref<Direction>('encode')
const variant = ref<Variant>('standard')
const stripPadding = ref(false)
const inputText = ref('')
const fileInfo = ref<FileInfo | null>(null)
const dragging = ref(false)

const fileInput = ref<HTMLInputElement>()
const imageInput = ref<HTMLInputElement>()

// ---------- Base64 编解码底层 ----------

function bytesToBase64(bytes: Uint8Array): string {
  // 分块处理，避免 String.fromCharCode 参数过多导致栈溢出
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function encodeBytes(bytes: Uint8Array): string {
  let base64 = bytesToBase64(bytes)
  if (variant.value === 'urlsafe') {
    base64 = base64.replace(/\+/g, '-').replace(/\//g, '_')
  }
  if (stripPadding.value) {
    base64 = base64.replace(/=+$/, '')
  }
  return base64
}

/** 去掉 dataURL 前缀、空白字符，并把 URL-safe 还原为标准字符集 */
function normalizeBase64(raw: string): string {
  return raw
    .trim()
    .replace(/^data:[^,]*;base64,/i, '')
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
}

function decodeBase64(raw: string): Uint8Array {
  const cleaned = normalizeBase64(raw)
  if (!cleaned) {
    throw new Error('没有可解码的内容')
  }

  const body = cleaned.replace(/=+$/, '')
  if (!/^[A-Za-z0-9+/]+$/.test(body)) {
    const bad = cleaned.replace(/[A-Za-z0-9+/=]/g, '')[0] || ''
    throw new Error(`包含非法字符「${bad}」，不是有效的 Base64`)
  }
  if (body.length % 4 === 1) {
    throw new Error('长度不合法，Base64 长度不可能是 4n + 1')
  }

  const padded = body + '='.repeat((4 - (body.length % 4)) % 4)
  try {
    return base64ToBytes(padded)
  } catch {
    throw new Error('解码失败，请检查内容是否完整')
  }
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

const IMAGE_SIGNATURES: Array<{ mime: string; match: (b: Uint8Array) => boolean }> = [
  { mime: 'image/png', match: b => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/jpeg', match: b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', match: b => b.length > 3 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  { mime: 'image/webp', match: b => b.length >= 12 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
  { mime: 'image/bmp', match: b => b.length > 2 && b[0] === 0x42 && b[1] === 0x4d },
  { mime: 'image/x-icon', match: b => b.length > 4 && b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00 },
]

function detectImageMime(bytes: Uint8Array): string {
  const hit = IMAGE_SIGNATURES.find(item => item.match(bytes))
  return hit ? hit.mime : ''
}

function toHexDump(bytes: Uint8Array, limit = 512): string {
  const slice = bytes.subarray(0, limit)
  const lines: string[] = []
  for (let i = 0; i < slice.length; i += 16) {
    lines.push(
      Array.from(slice.subarray(i, i + 16))
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' ')
    )
  }
  return lines.join('\n')
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(2)} MB`
}

function truncate(text: string) {
  return {
    display: text.length > MAX_DISPLAY ? text.slice(0, MAX_DISPLAY) : text,
    truncated: text.length > MAX_DISPLAY,
  }
}

// ---------- 结果计算 ----------

function emptyResult(error = '', meta = ''): Result {
  return {
    ok: false,
    value: '',
    display: '',
    truncated: false,
    imageUrl: '',
    mime: '',
    bytes: null,
    error,
    note: '',
    meta,
  }
}

const result = computed<Result>(() => {
  if (direction.value === 'encode') {
    if (fileInfo.value) {
      const { dataUrl, name, size, type } = fileInfo.value
      const body = dataUrl.slice(dataUrl.indexOf(',') + 1)
      const { display, truncated } = truncate(dataUrl)
      return {
        ok: true,
        value: dataUrl,
        display,
        truncated,
        imageUrl: type.startsWith('image/') ? dataUrl : '',
        mime: type,
        bytes: null,
        error: '',
        note: `已按 dataURL 输出，含 ${type} 前缀，可直接用于 img src / CSS`,
        meta: `${name} · ${formatSize(size)} → ${body.length} 字符`,
      }
    }

    const text = inputText.value
    if (!text) return emptyResult()

    const bytes = new TextEncoder().encode(text)
    const encoded = encodeBytes(bytes)
    const { display, truncated } = truncate(encoded)
    return {
      ok: true,
      value: encoded,
      display,
      truncated,
      imageUrl: '',
      mime: '',
      bytes: null,
      error: '',
      note: stripPadding.value || variant.value === 'urlsafe'
        ? `${variant.value === 'urlsafe' ? 'URL-safe 字符集' : '标准字符集'}${stripPadding.value ? ' · 已去掉 = 填充' : ''}`
        : '',
      meta: `${bytes.length} 字节 → ${encoded.length} 字符`,
    }
  }

  const raw = inputText.value
  if (!raw.trim()) return emptyResult()

  let bytes: Uint8Array
  try {
    bytes = decodeBase64(raw)
  } catch (e: any) {
    return emptyResult(e.message || '解码失败', '解码失败')
  }

  const text = decodeUtf8(bytes)
  const inputLen = normalizeBase64(raw).length

  if (text !== null) {
    const { display, truncated } = truncate(text)
    return {
      ok: true,
      value: text,
      display,
      truncated,
      imageUrl: '',
      mime: '',
      bytes,
      error: '',
      note: bytes.length === 0 ? '解码结果为空' : '',
      meta: `${inputLen} 字符 → ${bytes.length} 字节`,
    }
  }

  const mime = detectImageMime(bytes)
  const { display, truncated } = truncate(toHexDump(bytes))
  return {
    ok: true,
    value: toHexDump(bytes),
    display,
    truncated,
    imageUrl: mime ? `data:${mime};base64,${bytesToBase64(bytes)}` : '',
    mime,
    bytes,
    error: '',
    note: mime
      ? `不是 UTF-8 文本，已识别为 ${mime}，下方为 Hex 视图`
      : '解码结果不是 UTF-8 文本（二进制内容），下方为 Hex 视图',
    meta: `${inputLen} 字符 → ${bytes.length} 字节`,
  }
})

const inputStat = computed(() => {
  if (direction.value === 'encode' && fileInfo.value) return fileInfo.value.name
  const len = inputText.value.length
  return len ? `${len} 字符` : ''
})

/** 编码方向下，输入看起来像 Base64 时给个提示 */
const looksLikeBase64 = computed(() => {
  if (direction.value !== 'encode') return false
  const cleaned = normalizeBase64(inputText.value)
  if (cleaned.length < 16 || cleaned.length % 4 > 2) return false
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) return false
  return /[A-Z0-9+/=]/.test(cleaned)
})

const downloadName = computed(() => {
  if (direction.value === 'encode') {
    return fileInfo.value ? `${fileInfo.value.name}.base64.txt` : 'base64.txt'
  }
  if (result.value.mime) {
    return `decoded.${result.value.mime.split('/')[1].replace('jpeg', 'jpg')}`
  }
  return result.value.bytes && decodeUtf8(result.value.bytes) === null ? 'decoded.bin' : 'decoded.txt'
})

// ---------- 交互 ----------

function setDirection(dir: Direction) {
  direction.value = dir
  if (dir === 'decode') fileInfo.value = null
}

function swapDirection() {
  if (!result.value.ok) {
    setDirection(direction.value === 'encode' ? 'decode' : 'encode')
    return
  }
  if (result.value.value.length > MAX_FILL) {
    ElMessage.warning('内容过长，不适合回填到输入框')
    return
  }
  inputText.value = result.value.value
  fileInfo.value = null
  direction.value = direction.value === 'encode' ? 'decode' : 'encode'
}

function clearAll() {
  inputText.value = ''
  fileInfo.value = null
}

function pickFile(target: 'file' | 'image') {
  (target === 'image' ? imageInput.value : fileInput.value)?.click()
}

function readAsDataUrl(file: File) {
  if (file.size > MAX_FILE) {
    ElMessage.warning('文件超过 20MB，仅支持 20MB 以内的文件')
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    fileInfo.value = {
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      dataUrl: String(reader.result),
    }
    inputText.value = ''
    direction.value = 'encode'
  }
  reader.onerror = () => ElMessage.error('文件读取失败')
  reader.readAsDataURL(file)
}

function onFileChange(e: Event) {
  const el = e.target as HTMLInputElement
  const file = el.files?.[0]
  if (file) readAsDataUrl(file)
  el.value = ''
}

function onDrop(e: DragEvent) {
  dragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) readAsDataUrl(file)
}

function copyText(text: string) {
  const doCopy = (window as any).ztools?.copyText
    ? Promise.resolve((window as any).ztools.copyText(text))
    : navigator.clipboard.writeText(text)
  doCopy
    .then(() => ElMessage.success({ message: '已复制到剪贴板', duration: 800 }))
    .catch(() => ElMessage.error({ message: '复制失败', duration: 1000 }))
}

function downloadResult() {
  if (!result.value.ok) return
  let blob: Blob
  if (direction.value === 'decode' && result.value.bytes) {
    // 复制一份，确保底层是 ArrayBuffer（避免 SharedArrayBuffer 类型与 BlobPart 不兼容）
    const bytes = new Uint8Array(result.value.bytes)
    blob = new Blob([bytes], { type: result.value.mime || 'application/octet-stream' })
  } else {
    blob = new Blob([result.value.value], { type: 'text/plain;charset=utf-8' })
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = downloadName.value
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

if ((window as any).ztools?.onPluginEnter) {
  ;(window as any).ztools.onPluginEnter(() => {
    try { (window as any).ztools.setExpendHeight(600) } catch (_) {}
  })
}
</script>

<template>
  <div class="base64-tool">
    <h2>Base64 编解码</h2>
    <p class="desc">文本与 Base64 实时互转，支持 URL-safe 变体、去除填充，也可把文件、图片转成 Base64</p>

    <div class="toolbar">
      <el-radio-group :model-value="direction" size="small" @update:model-value="setDirection">
        <el-radio-button value="encode">编码</el-radio-button>
        <el-radio-button value="decode">解码</el-radio-button>
      </el-radio-group>

      <el-button link size="small" class="swap-btn" @click="swapDirection">
        {{ result.ok ? '结果回填并换向' : '换向' }}
      </el-button>

      <span class="spacer" />

      <template v-if="direction === 'encode'">
        <span class="opt-label">变体</span>
        <el-radio-group v-model="variant" size="small">
          <el-radio-button value="standard">标准</el-radio-button>
          <el-radio-button value="urlsafe">URL-safe</el-radio-button>
        </el-radio-group>
        <el-checkbox v-model="stripPadding" size="small">去掉 =</el-checkbox>
      </template>
    </div>

    <div class="panels">
      <!-- 输入 -->
      <div
        class="panel"
        :class="{ dragging }"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="onDrop"
      >
        <div class="panel-head">
          <span class="panel-title">输入</span>
          <span class="panel-stat">{{ inputStat }}</span>
          <span class="spacer" />
          <el-button link size="small" @click="pickFile('file')">文件</el-button>
          <el-button link size="small" @click="pickFile('image')">图片</el-button>
          <el-button link size="small" @click="clearAll" :disabled="!inputText && !fileInfo">清空</el-button>
        </div>

        <div v-if="fileInfo" class="file-card">
          <img v-if="fileInfo.type.startsWith('image/')" :src="fileInfo.dataUrl" class="file-thumb" alt="预览" />
          <div class="file-meta">
            <div class="file-name">{{ fileInfo.name }}</div>
            <div class="file-sub">{{ fileInfo.type }} · {{ formatSize(fileInfo.size) }}</div>
          </div>
          <el-button link size="small" @click="fileInfo = null">移除</el-button>
        </div>

        <el-input
          v-else
          v-model="inputText"
          type="textarea"
          resize="none"
          :placeholder="direction === 'encode' ? '在此输入或粘贴要编码的文本，也可把文件拖到这里…' : '在此粘贴 Base64 字符串，换行和空格会被自动忽略…'"
          class="input-box"
        />

        <div v-if="looksLikeBase64" class="tip">
          输入看起来像 Base64
          <el-button link size="small" class="tip-btn" @click="setDirection('decode')">切到解码 →</el-button>
        </div>
      </div>

      <!-- 输出 -->
      <div class="panel">
        <div class="panel-head">
          <span class="panel-title">输出</span>
          <span class="panel-stat">{{ result.meta }}</span>
          <span class="spacer" />
          <el-button link size="small" :disabled="!result.ok" @click="copyText(result.value)">复制</el-button>
          <el-button link size="small" :disabled="!result.ok" @click="downloadResult">下载</el-button>
        </div>

        <div v-if="result.error" class="error-box">{{ result.error }}</div>

        <template v-else-if="result.ok">
          <div v-if="result.imageUrl" class="image-preview">
            <img :src="result.imageUrl" alt="解码预览" />
          </div>
          <div class="out-box">{{ result.display || '（空）' }}</div>
          <div v-if="result.truncated" class="tip">内容较长，此处仅展示前 {{ MAX_DISPLAY }} 字符，复制与下载为完整内容</div>
          <div v-else-if="result.note" class="tip">{{ result.note }}</div>
        </template>

        <div v-else class="out-box placeholder">结果会实时显示在这里</div>
      </div>
    </div>

    <input ref="fileInput" type="file" class="hidden-input" @change="onFileChange" />
    <input ref="imageInput" type="file" accept="image/*" class="hidden-input" @change="onFileChange" />
  </div>
</template>

<style scoped>
.base64-tool { padding: 12px; max-width: 760px; margin: 0 auto; font-size: 13px; }
h2 { margin: 0 0 4px; font-size: 20px; font-weight: 600; }
.desc { color: #909399; margin: 0 0 12px; font-size: 13px; }

.toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.spacer { flex: 1; }
.opt-label { font-size: 12px; color: #909399; }
.swap-btn { color: #667eea; }
.toolbar :deep(.el-button.is-link) { color: #667eea; padding: 4px 6px; height: auto; font-size: 13px; }
.toolbar :deep(.el-button.is-link.is-disabled) { color: #c0c4cc; }

.panels { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.panel { display: flex; flex-direction: column; min-width: 0; }
.panel.dragging { outline: 1px dashed #667eea; outline-offset: 4px; border-radius: 6px; }

.panel-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; min-height: 22px; }
.panel-title { font-size: 13px; font-weight: 500; color: #303133; }
.panel-stat { font-size: 11px; color: #909399; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.panel-head :deep(.el-button.is-link) { color: #667eea; padding: 2px 4px; height: auto; font-size: 12px; }
.panel-head :deep(.el-button.is-link.is-disabled) { color: #c0c4cc; }

.input-box :deep(.el-textarea__inner) {
  height: 232px;
  box-sizing: border-box;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.5;
}

.file-card { display: flex; align-items: center; gap: 10px; height: 232px; box-sizing: border-box;
  padding: 12px; border: 1px solid var(--border-color, #e5e5e5); border-radius: 8px;
  background: var(--bg-card, #f5f7fa); overflow: hidden; }
.file-thumb { max-width: 96px; max-height: 100%; border-radius: 4px; object-fit: contain; }
.file-meta { flex: 1; min-width: 0; }
.file-name { font-weight: 500; color: #303133; word-break: break-all; line-height: 1.4; }
.file-sub { font-size: 11px; color: #909399; margin-top: 4px; word-break: break-all; }

.out-box { height: 232px; box-sizing: border-box; overflow: auto; padding: 10px 12px;
  border: 1px solid var(--border-color, #e5e5e5); border-radius: 8px; background: var(--bg-card, #f5f7fa);
  font-family: 'Consolas', 'Courier New', monospace; font-size: 12px; line-height: 1.6;
  white-space: pre-wrap; word-break: break-all; color: #303133; }
.out-box.placeholder { color: #c0c4cc; }

.image-preview { margin-bottom: 6px; padding: 8px; border: 1px solid var(--border-color, #e5e5e5);
  border-radius: 8px; background: var(--bg-card, #f5f7fa); text-align: center; }
.image-preview img { max-width: 100%; max-height: 120px; object-fit: contain; }

.error-box { min-height: 232px; box-sizing: border-box; padding: 10px 12px; border-radius: 8px;
  border: 1px solid #fde2e2; background: #fef0f0; color: #f56c6c; font-size: 13px; line-height: 1.6; }

.tip { margin-top: 5px; font-size: 11px; color: #909399; line-height: 1.5; word-break: break-all; }
.tip-btn { color: #667eea; font-size: 11px; padding: 0 2px; height: auto; vertical-align: baseline; }

.hidden-input { display: none; }

@media (prefers-color-scheme: dark) {
  h2 { color: #e0e0e0; }
  .desc, .opt-label, .tip { color: #8a8a8a; }
  .panel-title { color: #e0e0e0; }
  .panel-stat { color: #8a8a8a; }
  .toolbar :deep(.el-button.is-link) { color: #8ba4f7; }
  .toolbar :deep(.el-button.is-link.is-disabled) { color: #666; }
  .swap-btn { color: #8ba4f7; }
  .panel-head :deep(.el-button.is-link) { color: #8ba4f7; }
  .panel-head :deep(.el-button.is-link.is-disabled) { color: #666; }
  .file-card, .out-box, .image-preview { background: #2c2c2c; border-color: #444; }
  .file-name { color: #e0e0e0; }
  .file-sub { color: #8a8a8a; }
  .out-box { color: #d0d0d0; }
  .out-box.placeholder { color: #666; }
  .error-box { background: #2b1d1d; border-color: #4a2a2a; color: #f09595; }
  .tip-btn { color: #8ba4f7; }
}

@media (max-width: 620px) {
  .panels { grid-template-columns: 1fr; }
}
</style>
