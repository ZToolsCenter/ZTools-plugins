<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { ZButton, ZTag, useToast } from 'ztools-ui'
import EngineStatusCard from '../components/EngineStatusCard.vue'
import OcrImageViewer from '../components/OcrImageViewer.vue'
import { useNativeEngine } from '../composables/useNativeEngine'

/**
 * 截图识别子页（独立 feature screen-ocr 的全屏视图，仅 Windows）。
 *
 * 快捷键式流程：进入即自动调 ztools.screenCapture 截屏，截完自动跑微信 OCR。
 * 可视化（canvas 绘图 + 透明文字层悬浮 + 全屏缩放/拖动 + 结果列表）
 * 复用 OcrImageViewer 组件，与「识别」页体验一致。Esc 取消截屏不报错。
 *
 * native 引擎未就绪时渲染下载卡片引导下载；就绪后自动触发一次截屏。
 */

/** 视图状态：截屏中 / 识别中 / 完成 / 出错；idle 为就绪但尚未截屏。 */
type Phase = 'idle' | 'capturing' | 'recognizing' | 'done' | 'error'

const { success, error: errorToast } = useToast()
const { nativeReady, nativeState, checkNative } = useNativeEngine()

const phase = ref<Phase>('idle')
/** 截屏得到的图片 data URI（同时作为 OCR 输入源与预览源）。 */
const imageSrc = ref('')
const lines = ref<OcrLine[]>([])
const errorText = ref('')

/** 是否已在就绪后自动触发过一次截屏（防止 nativeReady 多次翻转重复弹截屏）。 */
let autoStarted = false

const hasResult = computed(() => lines.value.length > 0)
const plainText = computed(() => lines.value.map((l) => l.text).join('\n'))
const busy = computed(() => phase.value === 'capturing' || phase.value === 'recognizing')

/** 无图空态文案：按当前阶段区分（待截图 / 已取消 / 识别失败）。 */
const emptyText = computed(() => {
  switch (phase.value) {
    case 'capturing':
      return '请在屏幕上框选要识别的区域…'
    case 'error':
      return '识别失败，点击「重新截图」重试'
    default:
      return '点击「重新截图」开始，或直接框选屏幕区域'
  }
})

/**
 * 触发系统截屏并识别。
 * screenCapture 回调在用户按 Esc 取消时返回空字符串，此时回到 idle 态提示「已取消」。
 */
function capture(): void {
  if (busy.value) return
  phase.value = 'capturing'
  imageSrc.value = ''
  lines.value = []
  errorText.value = ''

  window.ztools.screenCapture((imgBase64: string) => {
    // 用户取消截屏（返回空）：不报错，回 idle 态
    if (!imgBase64) {
      phase.value = 'idle'
      errorToast('已取消截图')
      return
    }
    // screenCapture 返回纯 base64（无 data: 前缀），补成 data URI 供预览 + OCR
    const dataUri = imgBase64.startsWith('data:')
      ? imgBase64
      : 'data:image/png;base64,' + imgBase64
    imageSrc.value = dataUri
    recognize(dataUri)
  })
}

/** 调微信 OCR 识别 data URI 图片。 */
async function recognize(image: string): Promise<void> {
  phase.value = 'recognizing'
  errorText.value = ''
  lines.value = []
  try {
    const result = await window.services.ocrImageDetail(image)
    if (result.ok) {
      lines.value = result.lines ?? []
      phase.value = 'done'
      if (lines.value.length === 0) {
        errorToast('未识别到文字')
      } else {
        success(`识别完成，共 ${lines.value.length} 行`)
      }
    } else {
      phase.value = 'error'
      errorText.value = result.error || '识别失败'
      errorToast(errorText.value)
    }
  } catch (err: any) {
    phase.value = 'error'
    errorText.value = err?.message ? String(err.message) : String(err)
    errorToast(errorText.value)
  }
}

/** 复制全部识别文字到剪贴板。 */
function copyAll(): void {
  if (!plainText.value) return
  window.ztools.copyText(plainText.value)
  success('已复制全部文字')
}

/** 复制单行（由 OcrImageViewer 点击文字行时上抛）。 */
function onCopy(text: string): void {
  window.ztools.copyText(text)
  success('已复制该行')
}

/** Esc 退出插件（截屏进行中时由系统接管，不响应此处）。 */
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && phase.value !== 'capturing') {
    try {
      window.ztools.outPlugin()
    } catch (_) {
      /* ignore */
    }
  }
}

// native 就绪后自动触发一次截屏。useNativeEngine 初始化为 checking，
// checkNative() 完成后 ready 由 false→true，watch 即触发；autoStarted 防重复。
watch(nativeReady, (ready) => {
  if (ready && !autoStarted) {
    autoStarted = true
    capture()
  }
})

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  checkNative()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  // 释放 OCR 引擎子进程，与 RecognizeTest 一致
  window.services.ocrDispose()
})
</script>

<template>
  <div class="screen-ocr">
    <header class="page-head">
      <h2 class="page-title">截图识别</h2>
      <div class="page-meta">
        <span v-if="nativeReady" class="meta-item">
          <ZTag type="success" size="small">引擎就绪</ZTag>
        </span>
        <span v-else-if="nativeState === 'checking'" class="meta-item">
          <ZTag type="info" size="small">检查中…</ZTag>
        </span>
        <span v-else class="meta-item">
          <ZTag type="warning" size="small">引擎未就绪</ZTag>
        </span>
        <ZButton
          v-if="nativeReady"
          type="primary"
          :loading="phase === 'capturing'"
          :disabled="busy"
          @click="capture"
        >
          {{ phase === 'capturing' ? '截图中…' : '重新截图' }}
        </ZButton>
        <ZButton v-if="hasResult" @click="copyAll">复制全部</ZButton>
      </div>
    </header>

    <!-- 引擎未就绪：引导下载（截图场景允许下载自救） -->
    <EngineStatusCard
      v-if="!nativeReady && nativeState !== 'checking'"
      :show-actions="true"
      @downloaded="checkNative"
    />

    <template v-else-if="nativeReady">
      <!-- 可视化（canvas/透明文字层悬浮/全屏缩放拖动/结果列表）复用 OcrImageViewer -->
      <OcrImageViewer
        :image-src="imageSrc"
        :lines="lines"
        :loading="phase === 'recognizing'"
        :empty-text="emptyText"
        @copy="onCopy"
      />

      <div v-if="errorText && phase === 'error'" class="error-detail">{{ errorText }}</div>
    </template>
  </div>
</template>

<style scoped>
.screen-ocr {
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
  gap: 12px;
  font-size: 12px;
  color: var(--text-secondary, #999);
}

.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.error-detail {
  font-size: 13px;
  color: #e53935;
}
</style>
