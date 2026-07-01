<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { ZButton, ZTag, useToast } from 'ztools-ui'
import EngineStatusCard from '../components/EngineStatusCard.vue'
import OcrImageViewer from '../components/OcrImageViewer.vue'
import { useNativeEngine } from '../composables/useNativeEngine'

/**
 * 识别子页：保留原有拖拽/粘贴识别方式，新增「点按钮选图」。
 *
 * 图源获取（选图 / 拖拽 / 粘贴 / 外部 initialImage）在本页完成；
 * 可视化（canvas 绘图 + 透明文字层悬浮 + 全屏缩放/拖动 + 结果列表）
 * 复用 OcrImageViewer 组件。
 *
 * 支持外部 initialImage：img/files 入口进入时由父组件传入
 * （data URI / http(s) URL 直接预览；本地 path 经 preload.readFileAsDataURL
 * 转 data URI 后预览）。
 */

const props = withDefaults(
  defineProps<{
    /** 进入时预填的待识别图片（data URI 或本地 path）。 */
    initialImage?: string
  }>(),
  { initialImage: '' }
)

const { success, error } = useToast()
const { nativeReady, checkNative } = useNativeEngine()

// ─── 图片与识别状态 ──────────────────────────────────────────────────
// imageSrc 用于 canvas 预览（必须是可被 <img>/<canvas> 加载的 data URI / URL）。
// recognizeSrc 才是真正传给 ocrImageDetail 的源（可为本地 path）。
// 多数情况下二者相同；仅「本地 path 且无 data URI」时二者分离。
const imageSrc = ref('')
const recognizeSrc = ref('')
const loading = ref(false)
const errorText = ref('')
const lines = ref<OcrLine[]>([])
const dragOver = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const hasResult = computed(() => lines.value.length > 0)
const plainText = computed(() => lines.value.map((l) => l.text).join('\n'))

// 把 File 读成 data URL
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

// 通过隐藏 input 点击触发系统选图对话框
function pickImage() {
  fileInput.value?.click()
}

async function setImageFromFile(file: File) {
  if (!file.type.startsWith('image/')) {
    errorText.value = '请选择图片文件'
    return
  }
  errorText.value = ''
  lines.value = []
  const dataUrl = await readFileAsDataURL(file)
  imageSrc.value = dataUrl
  recognizeSrc.value = dataUrl
}

// 由外部 initialImage 设置（data URI 可预览；本地 path 经 preload 转 data URI 后预览）。
// data URI / http(s) URL 直接展示；本地 path 通过 readFileAsDataURL 转成
// data URI 再展示（超级面板「选择文件」入口拿到的是本地 path，渲染进程无法直接加载）。
async function setImageFromInitial(image: string) {
  errorText.value = ''
  lines.value = []
  recognizeSrc.value = image
  if (/^data:/i.test(image) || /^https?:\/\//i.test(image)) {
    imageSrc.value = image
  } else {
    // 本地 path：转 data URI 后预览；转换失败则仅识别不预览
    try {
      imageSrc.value = window.services.readFileAsDataURL(image)
    } catch (e: any) {
      imageSrc.value = ''
    }
  }
}

// 选图 input change
async function onFileChange(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  await setImageFromFile(file)
  target.value = ''
}

// 拖拽
function onDrop(e: DragEvent) {
  dragOver.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) setImageFromFile(file)
}
function onDragOver() {
  dragOver.value = true
}
function onDragLeave() {
  dragOver.value = false
}

// 粘贴图片
async function onPaste(e: ClipboardEvent) {
  const item = Array.from(e.clipboardData?.items || []).find((i) =>
    i.type.startsWith('image/')
  )
  const file = item?.getAsFile()
  if (file) await setImageFromFile(file)
}

// 执行识别（用 recognizeSrc 作为真实输入源）
async function recognize() {
  if (!recognizeSrc.value || !nativeReady.value) return
  loading.value = true
  errorText.value = ''
  lines.value = []
  try {
    const result = await window.services.ocrImageDetail(recognizeSrc.value)
    if (result.ok) {
      lines.value = result.lines ?? []
      if (lines.value.length === 0) {
        error('未识别到文字')
      } else {
        success(`识别完成，共 ${lines.value.length} 行`)
      }
    } else {
      errorText.value = result.error || '识别失败'
      error(errorText.value)
    }
  } catch (err: any) {
    errorText.value = err?.message ? String(err.message) : String(err)
    error(errorText.value)
  } finally {
    loading.value = false
  }
}

// 复制全部识别文字
function copyAll() {
  if (!plainText.value) return
  window.ztools.copyText(plainText.value)
  success('已复制全部文字')
}

// 复制单行（由 OcrImageViewer 点击文字行时上抛）
function onCopy(text: string) {
  window.ztools.copyText(text)
  success('已复制该行')
}

// ─── 外部 initialImage 自动识别 ──────────────────────────────────────
// native 未就绪时缓存，等就绪后补识别（参考原 Ocr/index.vue 的 pending 机制）。
const pendingInitial = ref('')
async function applyInitial(image: string) {
  if (!image) return
  if (!nativeReady.value) {
    pendingInitial.value = image
    return
  }
  await setImageFromInitial(image)
  recognize()
}

watch(
  () => props.initialImage,
  (image) => {
    if (image) applyInitial(image)
  },
  { immediate: true }
)

// native 由未就绪变为就绪时，补识别缓存的 initialImage
watch(nativeReady, (ready) => {
  if (ready && pendingInitial.value) {
    const img = pendingInitial.value
    pendingInitial.value = ''
    applyInitial(img)
  }
})

onMounted(() => {
  window.addEventListener('paste', onPaste)
  checkNative()
})

onUnmounted(() => {
  window.removeEventListener('paste', onPaste)
  window.services.ocrDispose()
})
</script>

<template>
  <div class="recognize">
    <header class="page-head">
      <h2 class="page-title">识别</h2>
      <div class="page-meta">
        <span v-if="nativeReady" class="meta-item">
          <ZTag type="success" size="small">引擎就绪</ZTag>
        </span>
        <span v-else class="meta-item">
          <ZTag type="warning" size="small">引擎未就绪</ZTag>
        </span>
      </div>
    </header>

    <template v-if="!nativeReady">
      <!-- 引擎未就绪：展示状态卡片引导下载 -->
      <EngineStatusCard :show-actions="false" @downloaded="checkNative" />
    </template>

    <template v-else>
      <!-- 工具栏：选图按钮 + 识别按钮 + 复制全部 -->
      <div class="toolbar">
        <ZButton type="primary" @click="pickImage">选择图片</ZButton>
        <ZButton :disabled="!recognizeSrc || loading" :loading="loading" @click="recognize">
          {{ loading ? '识别中…' : '识别' }}
        </ZButton>
        <ZButton v-if="hasResult" @click="copyAll">复制全部</ZButton>
        <span class="toolbar-tip">支持点击选图 · 拖入图片 · 粘贴图片（Ctrl+V）</span>
      </div>

      <!-- 图片舞台：拖拽落区外壳 + 可视化（canvas/透明文字层/全屏/结果列表）复用 OcrImageViewer -->
      <div
        class="stage"
        :class="{ 'drag-over': dragOver }"
        @dragover.prevent="onDragOver"
        @dragleave.prevent="onDragLeave"
        @drop.prevent="onDrop"
      >
        <OcrImageViewer
          :image-src="imageSrc"
          :lines="lines"
          :loading="loading"
          empty-text="点击上方「选择图片」，或拖入 / 粘贴图片"
          @copy="onCopy"
        />
      </div>

      <div v-if="errorText" class="error-detail">{{ errorText }}</div>
    </template>

    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      class="file-input"
      @change="onFileChange"
    />
  </div>
</template>

<style scoped>
.recognize {
  padding: 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-sizing: border-box;
}

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
}

.page-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.page-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 12px;
  color: var(--text-secondary, #999);
}

.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* ── 工具栏 ── */
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.toolbar-tip {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-secondary, #999);
}

/* ── 拖拽落区外壳（仅保留拖拽高亮，可视化交由 OcrImageViewer） ── */
.stage {
  position: relative;
  min-height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1.5px dashed var(--border-color, #c0c0c0);
  border-radius: 12px;
  overflow: visible;
  padding: 16px;
  transition: border-color 0.15s, background 0.15s;
  background: var(--stage-bg, rgba(0, 0, 0, 0.02));
}

.stage.drag-over {
  border-color: var(--primary-color, #1976d2);
  background: var(--hover-bg, rgba(25, 118, 210, 0.05));
}

.error-detail {
  font-size: 13px;
  color: #e53935;
}

.file-input {
  display: none;
}
</style>
