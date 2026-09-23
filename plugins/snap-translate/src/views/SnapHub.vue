<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useToast } from 'ztools-ui'
import {
  ocrOnly,
  ocrTranslate,
  ocrWithBoxes,
  translateLines,
  OcrUnavailableError
} from '../composables/useOcrTranslate'
import { openResultWindow } from '../composables/useResultWindow'
import { buildOcrResultPayload } from '../pinGeometry'
import { hasRealBoxes, zipOverlay, type PinOverlayLine } from '../pinOverlay'
import { loadBoardSettings } from '../composables/useBoardSettings'
import OcrResult from './OcrResult.vue'

/**
 * 三个入口：
 *   1. 贴图（默认）：截图成悬浮贴
 *        - 点 OCR / 翻译；翻译结果形态由设置决定（弹窗 / 原文覆盖，默认弹窗）
 *   2. OCR：截完不贴图，主窗直接出识别文字
 *   3. OCR翻译：截完不贴图，主窗左右两栏对照
 */

const props = defineProps<{
  autoAction?: 'ocr-only' | 'ocr-translate' | ''
}>()

type Phase = 'capturing' | 'board-open' | 'processing' | 'ocr-missing' | 'error' | 'result'

const { success, error: errorToast, info: infoToast } = useToast()

const phase = ref<Phase>('capturing')
const errorText = ref('')
const image = ref('')
const diagnostics = ref<string[]>([])
const statusHint = ref('')
const resultMode = ref<'ocr' | 'ocr-translate'>('ocr')
const result = ref<{
  lines: SnapLine[]
  translateOk: boolean
  translateError?: string
  targetLang?: string
  detectedFrom?: string
  ocrProvider?: string
  translateProvider?: string
} | null>(null)
/** 最近一次贴图 OCR 的框：「直接翻译」用来盖在原文字上。 */
const pinBoxes = ref<PinOverlayLine[]>([])
const pinImageSize = ref({ width: 0, height: 0 })
/** 最近一次 OCR 用的引擎（弹窗低调展示）。 */
const lastOcrProvider = ref('')
/** screenCapture 回调的截图区域，贴图打开在截图原处。 */
const captureBounds = ref<{ x: number; y: number; width?: number; height?: number } | null>(null)

const busy = computed(
  () => phase.value === 'capturing' || phase.value === 'processing'
)

function inject(update: Record<string, unknown>): void {
  try {
    window.services.injectBoardUpdate(update)
  } catch (_) {
    /* ignore */
  }
}

/** 贴图旁的简洁结果框。 */
function openSide(resultPayload: SnapResultPayload): void {
  try {
    if (typeof window.services.openSideResult === 'function') {
      const ok = window.services.openSideResult(resultPayload)
      if (ok) return
    }
  } catch (_) {
    /* fallthrough */
  }
  openResultWindow(resultPayload)
}

function compactPayload(data: {
  lines: SnapLine[]
  translateOk: boolean
  translateError?: string
  targetLang?: string
  detectedFrom?: string
  ocrProvider?: string
  translateProvider?: string
  diagnostics?: string[]
}): SnapResultPayload {
  return buildOcrResultPayload({
    image: image.value,
    lines: data.lines,
    targetLang: data.targetLang,
    detectedFrom: data.detectedFrom,
    isDark: window.ztools.isDarkColors(),
    logo: window.services.pluginLogoDataUrl(),
    translateOk: data.translateOk,
    translateError: data.translateError,
    diagnostics: data.diagnostics,
    ocrProvider: data.ocrProvider || lastOcrProvider.value || undefined,
    translateProvider: data.translateProvider
  })
}

function closeBoardAndSide(): void {
  try {
    window.services.closeStickyBoard()
  } catch (_) {
    /* ignore */
  }
  try {
    window.services.closeSideResult?.()
  } catch (_) {
    /* ignore */
  }
  try {
    window.ztools.outPlugin()
  } catch (_) {
    /* ignore */
  }
}
function rememberImageSize(data: any): void {
  const w = Number(data?.imageWidth) || 0
  const h = Number(data?.imageHeight) || 0
  if (w > 0 && h > 0) pinImageSize.value = { width: w, height: h }
}

function paintPinOverlay(translated: string[]): boolean {
  if (!hasRealBoxes(pinBoxes.value)) {
    inject({ type: 'error', working: false, message: '无法定位原文位置' })
    errorToast('无法在原文位置覆盖。请下载微信 OCR 或 Paddle（需带检测框）。')
    return false
  }
  const overlayLines = zipOverlay(
    pinBoxes.value,
    translated,
    pinImageSize.value.width,
    pinImageSize.value.height
  )
  if (!overlayLines.length) {
    inject({ type: 'error', working: false, message: '覆盖层为空' })
    return false
  }
  inject({
    type: 'pin-overlay',
    working: false,
    message: '已覆盖译文',
    overlayLines
  })
  try {
    window.services.closeSideResult?.()
  } catch (_) {
    /* ignore */
  }
  return true
}

/** 按通用设置决定翻译结果：弹窗（默认）或原文覆盖。 */
async function presentTranslateResult(
  payload: SnapResultPayload,
  translated: string[]
): Promise<void> {
  const mode = loadBoardSettings().translateResultMode || 'popup'
  console.info('[snap-translate] presentTranslateResult mode=' + mode)
  if (mode === 'overlay') {
    // 覆盖模式：若尚无检测框，现场再取一次（微信/Paddle优先）
    if (!hasRealBoxes(pinBoxes.value) && image.value) {
      try {
        const extra = await ocrWithBoxes(image.value, { preferBoxes: true })
        if (hasRealBoxes(extra.boxes)) {
          pinBoxes.value = extra.boxes
          if (!lastOcrProvider.value) lastOcrProvider.value = extra.ocrProvider || ''
        }
      } catch (_) {
        /* ignore */
      }
    }
    if (hasRealBoxes(pinBoxes.value) && paintPinOverlay(translated)) {
      success('已覆盖译文')
      return
    }
    infoToast('无法原位覆盖（无检测框），已改用弹窗')
  }
  openSide(payload)
  success('翻译完成')
}

function wireBoardHandlers(): void {
  window.services.setBoardHandlers({
    async onOcr(data: any) {
      inject({ type: 'status', working: true, message: '识别中…' })
      try {
        if (!image.value) throw new Error('无截图')
        rememberImageSize(data)
        const preferBoxes = loadBoardSettings().translateResultMode === 'overlay'
        const result = await ocrWithBoxes(image.value, { preferBoxes })
        diagnostics.value = result.diagnostics
        pinBoxes.value = result.boxes
        lastOcrProvider.value = result.ocrProvider || ''
        inject({
          type: 'ocr',
          working: false,
          message: result.lines.length ? '识别完成' : '未识别到文字',
          lines: result.lines
        })
        if (!result.lines.length) infoToast('未识别到文字')
        else success('识别完成')
        openSide(
          compactPayload({
            lines: result.lines,
            translateOk: false,
            translateError: '仅识别',
            ocrProvider: result.ocrProvider,
            diagnostics: result.diagnostics
          })
        )
      } catch (err: any) {
        handleErr(err, true)
      }
    },
    async onTranslate(data: any) {
      inject({ type: 'status', working: true, message: '翻译中…' })
      try {
        const source: string[] = Array.isArray(data?.sourceLines) ? data.sourceLines : []
        if (!source.length) throw new Error('请先 OCR 再翻译')
        rememberImageSize(data)
        const result = await translateLines(source, data?.to, data?.from)
        diagnostics.value = result.diagnostics
        if (!result.translateOk) {
          inject({ type: 'error', working: false, message: result.translateError || '翻译不可用' })
          errorToast('翻译不可用：' + (result.translateError || '见日志'))
          return
        }
        inject({ type: 'translate', working: false, message: '翻译完成' })
        await presentTranslateResult(
          compactPayload({
            lines: result.lines,
            translateOk: true,
            targetLang: result.targetLang,
            detectedFrom: result.detectedFrom,
            ocrProvider: lastOcrProvider.value || undefined,
            translateProvider: result.translateProvider,
            diagnostics: result.diagnostics
          }),
          result.lines.map((l) => l.translated)
        )
      } catch (err: any) {
        handleErr(err, true)
      }
    },
    async onOcrTranslate(data: any) {
      // 未先 OCR 时点「翻译」：识别+翻译，结果形态由「翻译按钮结果」设置决定。
      inject({ type: 'status', working: true, message: '识别+翻译…' })
      try {
        if (!image.value) throw new Error('无截图')
        rememberImageSize(data)
        const preferBoxes = loadBoardSettings().translateResultMode === 'overlay'
        const ocr = await ocrWithBoxes(image.value, { preferBoxes })
        pinBoxes.value = ocr.boxes
        lastOcrProvider.value = ocr.ocrProvider || ''
        diagnostics.value = ocr.diagnostics
        if (!ocr.lines.length) {
          inject({ type: 'ocr-translate', working: false, message: '未识别到文字', lines: [] })
          infoToast('未识别到文字')
          return
        }
        const result = await translateLines(ocr.lines.map((l) => l.text), data?.to, data?.from)
        diagnostics.value = [...ocr.diagnostics, ...result.diagnostics]
        if (!result.translateOk) {
          inject({ type: 'error', working: false, message: result.translateError || '翻译不可用' })
          errorToast('翻译不可用：' + (result.translateError || '见日志'))
          return
        }
        inject({ type: 'ocr-translate', working: false, message: '翻译完成' })
        await presentTranslateResult(
          compactPayload({
            lines: result.lines,
            translateOk: true,
            targetLang: result.targetLang,
            detectedFrom: result.detectedFrom,
            ocrProvider: ocr.ocrProvider,
            translateProvider: result.translateProvider,
            diagnostics: result.diagnostics
          }),
          result.lines.map((l) => l.translated)
        )
      } catch (err: any) {
        handleErr(err, true)
      }
    },
    onCopyImage(data: any) {
      const img = (data && data.image) || image.value
      if (!img) return
      try {
        window.ztools.copyImage(img)
        success('已复制图片')
        if (data?.closeAfter) closeBoardAndSide()
      } catch (err: any) {
        errorToast('复制失败')
      }
    },
    onSave(data: any) {
      const img = (data && data.image) || image.value
      if (!img) {
        errorToast('没有可保存的图片')
        return
      }
      try {
        const dest = window.ztools.showSaveDialog({
          title: '保存截图',
          defaultPath: 'snap-' + Date.now() + '.png',
          buttonLabel: '保存',
          filters: [
            { name: 'PNG', extensions: ['png'] },
            { name: 'JPEG', extensions: ['jpg', 'jpeg'] },
            { name: 'WebP', extensions: ['webp'] },
            { name: 'BMP', extensions: ['bmp'] }
          ]
        })
        if (!dest) return
        window.services.saveImageFile(img, dest)
        success('已保存：' + dest)
        if (data?.closeAfter) closeBoardAndSide()
      } catch (err: any) {
        errorToast('保存失败：' + (err?.message ? String(err.message) : String(err)))
      }
    },
    onOpenSettings() {
      try {
        window.ztools.showMainWindow()
      } catch (_) {
        /* ignore */
      }
      try {
        window.ztools.redirect('截图翻译设置', '')
      } catch (_) {
        errorToast('无法打开设置，请搜索「截图翻译设置」')
      }
    },
    onClose() {
      try {
        window.services.closeStickyBoard()
      } catch (_) {
        /* ignore */
      }
      try {
        window.services.closeSideResult?.()
      } catch (_) {
        /* ignore */
      }
      try {
        window.ztools.outPlugin()
      } catch (_) {
        /* ignore */
      }
    },
    onLog(data: any) {
      if (data?.message) diagnostics.value = [...diagnostics.value, String(data.message)]
    }
  })
}

function openBoard(): void {
  if (!image.value) return
  wireBoardHandlers()
  const ok = window.services.openStickyBoard({
    image: image.value,
    isDark: window.ztools.isDarkColors(),
    logo: window.services.pluginLogoDataUrl(),
    title: '悬浮贴',
    captureBounds: captureBounds.value || undefined
  })
  if (!ok) {
    phase.value = 'error'
    errorText.value = '打开悬浮贴失败'
    errorToast(errorText.value)
    return
  }
  phase.value = 'board-open'
  try {
    window.ztools.hideMainWindow()
  } catch (_) {
    /* ignore */
  }
}

/** 直接模式：在主窗口展示大框结果（仿「翻译文字」双栏）。 */
function showResult(
  mode: 'ocr' | 'ocr-translate',
  data: {
    lines: SnapLine[]
    translateOk: boolean
    translateError?: string
    targetLang?: string
    detectedFrom?: string
    ocrProvider?: string
    translateProvider?: string
  }
): void {
  resultMode.value = mode
  result.value = data
  phase.value = 'result'
  try {
    window.ztools.showMainWindow()
  } catch (_) {
    /* ignore */
  }
}

/** OCR：截完不展示悬浮贴，识别完成在主窗大框展示原文。 */
async function runDirectOcr(): Promise<void> {
  phase.value = 'processing'
  statusHint.value = '正在识别…'
  try {
    if (!image.value) throw new Error('无截图')
    const result = await ocrOnly(image.value)
    diagnostics.value = result.diagnostics
    if (!result.lines.length) infoToast('未识别到文字')
    else success(`识别 ${result.lines.length} 行`)
    showResult('ocr', {
      lines: result.lines,
      translateOk: false,
      translateError: '仅识别（未翻译）',
      ocrProvider: result.ocrProvider
    })
  } catch (err: any) {
    handleErr(err, false)
  }
}

/** OCR翻译：截完不展示悬浮贴，识别+翻译完成在主窗大框展示对照。 */
async function runDirectOcrTranslate(): Promise<void> {
  phase.value = 'processing'
  statusHint.value = '正在识别并翻译…'
  try {
    if (!image.value) throw new Error('无截图')
    const result = await ocrTranslate(image.value)
    diagnostics.value = result.diagnostics
    if (!result.lines.length) infoToast('未识别到文字')
    else if (!result.translateOk) errorToast('翻译不可用：' + (result.translateError || '见日志'))
    else success(`完成 ${result.lines.length} 行`)
    showResult('ocr-translate', {
      lines: result.lines,
      translateOk: result.translateOk,
      translateError: result.translateError,
      targetLang: result.targetLang,
      detectedFrom: result.detectedFrom,
      ocrProvider: result.ocrProvider,
      translateProvider: result.translateProvider
    })
  } catch (err: any) {
    handleErr(err, false)
  }
}

function capture(): void {
  if (phase.value === 'processing') return
  phase.value = 'capturing'
  errorText.value = ''
  image.value = ''
  pinBoxes.value = []
  pinImageSize.value = { width: 0, height: 0 }
  captureBounds.value = null

  window.ztools.screenCapture((imgBase64: string, bounds?: { x: number; y: number; width?: number; height?: number }) => {
    if (!imgBase64) {
      try {
        window.ztools.outPlugin()
      } catch (_) {
        /* ignore */
      }
      return
    }
    image.value = imgBase64.startsWith('data:')
      ? imgBase64
      : 'data:image/png;base64,' + imgBase64
    captureBounds.value =
      bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)
        ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
        : null

    const auto = props.autoAction || ''
    if (auto === 'ocr-only') {
      void runDirectOcr()
      return
    }
    if (auto === 'ocr-translate') {
      void runDirectOcrTranslate()
      return
    }
    openBoard()
  })
}

function handleErr(err: any, toBoard = false): void {
  if (err instanceof OcrUnavailableError) {
    phase.value = 'ocr-missing'
    errorText.value = err.message
    if (toBoard) inject({ type: 'error', working: false, message: err.message })
    try {
      window.ztools.showMainWindow()
    } catch (_) {
      /* ignore */
    }
    return
  }
  const msg = err?.message ? String(err.message) : String(err)
  errorText.value = msg
  if (toBoard) inject({ type: 'error', working: false, message: msg })
  else phase.value = 'error'
  errorToast(msg)
  console.error('[snap-translate]', err)
}

function exit(): void {
  try {
    window.services.closeStickyBoard()
  } catch (_) {
    /* ignore */
  }
  try {
    window.services.closeSideResult?.()
  } catch (_) {
    /* ignore */
  }
  try {
    window.ztools.outPlugin()
  } catch (_) {
    /* ignore */
  }
}

onMounted(() => {
  wireBoardHandlers()
  capture()
})

onUnmounted(() => {
  // 切到本插件设置页时悬浮贴仍在，handlers 必须留下
  try {
    if (!window.services.getBoardBounds?.()) {
      window.services.setBoardHandlers(null)
    }
  } catch (_) {
    /* ignore */
  }
})
</script>

<template>
  <div class="hub" :class="{ 'hub-result': phase === 'result' }">
    <div v-if="phase === 'capturing'" class="state-block">
      <div class="spinner" />
      <p class="state-text">请框选屏幕区域…（Esc 取消）</p>
    </div>

    <div v-else-if="phase === 'processing'" class="state-block">
      <div class="spinner" />
      <p class="state-text">{{ statusHint || '处理中…' }}</p>
    </div>

    <div v-else-if="phase === 'ocr-missing'" class="state-block guide">
      <p class="guide-title">⚠ 未找到可用的 OCR 提供商</p>
      <p class="guide-text">
        请在本插件「截图翻译设置」下载 OCR 引擎或配置 Paddle，并在宿主「设置 → 提供商」设为默认 OCR。
      </p>
      <p v-if="errorText" class="guide-detail">{{ errorText }}</p>
      <div class="guide-actions">
        <button type="button" class="action-btn primary" @click="capture">重新截图</button>
        <button type="button" class="action-btn" @click="exit">退出</button>
      </div>
    </div>

    <div v-else-if="phase === 'error'" class="state-block guide">
      <p class="guide-title">出错了</p>
      <p class="guide-detail">{{ errorText }}</p>
      <div class="guide-actions">
        <button type="button" class="action-btn primary" @click="capture">重新截图</button>
        <button type="button" class="action-btn" @click="exit">退出</button>
      </div>
    </div>

    <!-- OCR / OCR翻译：主窗结果 -->
    <OcrResult
      v-else-if="phase === 'result' && result"
      :mode="resultMode"
      :lines="result.lines"
      :translate-ok="result.translateOk"
      :translate-error="result.translateError"
      :target-lang="result.targetLang"
      :detected-from="result.detectedFrom"
      :ocr-provider="result.ocrProvider"
      :translate-provider="result.translateProvider"
      @again="capture"
      @exit="exit"
    />

    <!-- 悬浮贴已开：主窗隐藏，此处仅兜底提示 -->
    <div v-else class="state-block">
      <p class="state-text">
        贴图已打开 · 拖动移动 · 边缘缩放 · 点 OCR / 翻译弹出结果
      </p>
      <div class="guide-actions">
        <button type="button" class="action-btn primary" @click="capture">再截一张</button>
        <button type="button" class="action-btn" @click="exit">退出</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hub {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--z-bg-color, #fff);
  color: var(--z-text-color, #303133);
}

.hub-result {
  align-items: stretch;
  justify-content: stretch;
}

.state-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 32px;
  text-align: center;
  max-width: 420px;
}
.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--z-border-color, #dcdfe6);
  border-top-color: var(--primary-color, #409eff);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.state-text {
  margin: 0;
  font-size: 14px;
  color: var(--z-text-color-secondary, #909399);
  line-height: 1.5;
}
.guide-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.guide-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--z-text-color-secondary, #909399);
}
.guide-detail {
  margin: 0;
  font-size: 12px;
  color: var(--z-color-danger, #f56c6c);
  word-break: break-all;
}
.guide-actions {
  display: flex;
  gap: 12px;
}

/* 实心底 + 实字色：避免 ZButton 透明继承导致看不清 */
.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 34px;
  padding: 0 18px;
  border: none;
  border-radius: 8px;
  background: #e8eaee;
  color: #111827;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  -webkit-font-smoothing: antialiased;
}

.action-btn:hover {
  background: #d5d9e0;
}

.action-btn.primary {
  background: #0b3d73;
  color: #ffffff;
}

.action-btn.primary:hover {
  background: #0a4d90;
}

:global(html.dark) .action-btn {
  background: #3a3e46;
  color: #f8fafc;
}

:global(html.dark) .action-btn:hover {
  background: #4b515c;
}

:global(html.dark) .action-btn.primary {
  background: #7dd3fc;
  color: #082f49;
}

:global(html.dark) .action-btn.primary:hover {
  background: #bae6fd;
}
</style>
