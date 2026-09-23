<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ZButton, useToast } from 'ztools-ui'
import {
  ocrOnly,
  ocrTranslate,
  translateLines,
  OcrUnavailableError
} from '../composables/useOcrTranslate'

/**
 * 截图悬浮贴编排（feature: snap-board）。
 *
 * 1. screenCapture → 打开 alwaysOnTop 悬浮贴（标记划线）
 * 2. 悬浮贴 sendToParent 请求 OCR / 翻译 / OCR+翻译
 * 3. 本页保持存活（hideMainWindow，不 kill），preload 调回 handlers 执行管线
 * 4. injectBoardUpdate 把结果/诊断日志写回悬浮贴
 */

type Phase = 'idle' | 'capturing' | 'opened' | 'ocr-missing' | 'error'

const { success, error: errorToast, info: infoToast } = useToast()

const phase = ref<Phase>('idle')
const errorText = ref('')
const diagnostics = ref<string[]>([])

const busy = computed(() => phase.value === 'capturing')

function inject(update: Record<string, unknown>): void {
  try {
    window.services.injectBoardUpdate(update)
  } catch (_) {
    /* ignore */
  }
}

function wireHandlers(): void {
  window.services.setBoardHandlers({
    async onOcr() {
      inject({ type: 'status', working: true, message: '正在识别…' })
      try {
        // 用原图识别（避免笔迹干扰）；image 由 board 消息带上，handlers 从闭包取 lastImage
        const image = lastImage
        if (!image) throw new Error('无截图')
        const result = await ocrOnly(image)
        diagnostics.value = result.diagnostics
        inject({
          type: 'ocr',
          working: false,
          message: result.lines.length ? `识别 ${result.lines.length} 行` : '未识别到文字',
          lines: result.lines,
          diagnostics: result.diagnostics,
          translateOk: true
        })
        if (!result.lines.length) infoToast('未识别到文字')
        else success(`识别 ${result.lines.length} 行`)
      } catch (err: any) {
        handleErr(err)
      }
    },
    async onTranslate(data: any) {
      inject({ type: 'status', working: true, message: '正在翻译…' })
      try {
        const source: string[] = Array.isArray(data?.sourceLines) ? data.sourceLines : []
        if (!source.length) throw new Error('请先识别文字再翻译')
        const result = await translateLines(source)
        diagnostics.value = result.diagnostics
        inject({
          type: 'translate',
          working: false,
          message: result.translateOk
            ? `翻译完成 (${result.translateProvider || 'default'})`
            : '翻译不可用',
          lines: result.lines,
          diagnostics: result.diagnostics,
          translateOk: result.translateOk,
          translateError: result.translateError,
          translateProvider: result.translateProvider
        })
        if (!result.translateOk) {
          errorToast('翻译不可用，见悬浮贴诊断日志')
          console.error('[snap-translate] translate failed', result.translateError, result.diagnostics)
        } else {
          success('翻译完成')
        }
      } catch (err: any) {
        handleErr(err)
      }
    },
    async onOcrTranslate() {
      inject({ type: 'status', working: true, message: '正在识别并翻译…' })
      try {
        const image = lastImage
        if (!image) throw new Error('无截图')
        const result = await ocrTranslate(image)
        diagnostics.value = result.diagnostics
        inject({
          type: 'ocr-translate',
          working: false,
          message: result.translateOk
            ? `完成 ${result.lines.length} 行 (${result.translateProvider || 'default'})`
            : result.lines.length
              ? '已识别，翻译不可用'
              : '未识别到文字',
          lines: result.lines,
          diagnostics: result.diagnostics,
          translateOk: result.translateOk,
          translateError: result.translateError,
          translateProvider: result.translateProvider
        })
        if (!result.translateOk && result.lines.length) {
          errorToast('翻译不可用：' + (result.translateError || '见日志'))
          console.error('[snap-translate] ocr-translate degrade', result.diagnostics)
        } else if (result.lines.length) {
          success(`完成 ${result.lines.length} 行`)
        } else {
          infoToast('未识别到文字')
        }
      } catch (err: any) {
        handleErr(err)
      }
    },
    onClose() {
      try {
        window.services.closeStickyBoard()
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

function handleErr(err: any): void {
  if (err instanceof OcrUnavailableError) {
    phase.value = 'ocr-missing'
    errorText.value = err.message
    inject({ type: 'error', working: false, message: err.message })
    return
  }
  const msg = err?.message ? String(err.message) : String(err)
  errorText.value = msg
  inject({ type: 'error', working: false, message: msg })
  errorToast(msg)
  console.error('[snap-translate] board error', err)
}

let lastImage = ''
let lastCaptureBounds: { x: number; y: number; width?: number; height?: number } | null = null

function capture(): void {
  if (busy.value) return
  phase.value = 'capturing'
  errorText.value = ''

  window.ztools.screenCapture((imgBase64: string, bounds?: { x: number; y: number; width?: number; height?: number }) => {
    if (!imgBase64) {
      try {
        window.ztools.outPlugin()
      } catch (_) {
        /* ignore */
      }
      return
    }
    const dataUri = imgBase64.startsWith('data:')
      ? imgBase64
      : 'data:image/png;base64,' + imgBase64
    lastCaptureBounds =
      bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)
        ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
        : null
    openBoard(dataUri)
  })
}

function openBoard(image: string): void {
  lastImage = image
  wireHandlers()
  const ok = window.services.openStickyBoard({
    image,
    isDark: window.ztools.isDarkColors(),
    logo: window.services.pluginLogoDataUrl(),
    title: '截图悬浮贴',
    captureBounds: lastCaptureBounds || undefined
  })
  if (!ok) {
    phase.value = 'error'
    errorText.value = '打开悬浮贴失败'
    errorToast(errorText.value)
    return
  }
  phase.value = 'opened'
  // 隐藏主窗，保留进程以便处理 sendToParent
  try {
    window.ztools.hideMainWindow()
  } catch (_) {
    /* ignore */
  }
}

function exit(): void {
  try {
    window.services.closeStickyBoard()
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
  wireHandlers()
  capture()
})

onUnmounted(() => {
  try {
    window.services.setBoardHandlers(null)
  } catch (_) {
    /* ignore */
  }
})
</script>

<template>
  <div class="page">
    <div v-if="busy" class="state-block">
      <div class="spinner" />
      <p class="state-text">请框选屏幕区域…（Esc 取消）</p>
    </div>

    <div v-else-if="phase === 'ocr-missing'" class="state-block guide">
      <p class="guide-title">⚠ 未找到可用的 OCR 提供商</p>
      <p class="guide-text">
        请在本插件「截图翻译设置」配置 OCR，并在宿主「设置 → 提供商」设为默认。
      </p>
      <p v-if="errorText" class="guide-detail">{{ errorText }}</p>
      <div class="guide-actions">
        <ZButton type="primary" @click="capture">重试</ZButton>
        <ZButton @click="exit">退出</ZButton>
      </div>
    </div>

    <div v-else-if="phase === 'error'" class="state-block guide">
      <p class="guide-title">出错了</p>
      <p class="guide-detail">{{ errorText }}</p>
      <div class="guide-actions">
        <ZButton type="primary" @click="capture">重新截图</ZButton>
        <ZButton @click="exit">退出</ZButton>
      </div>
    </div>

    <div v-else class="state-block">
      <p class="state-text">悬浮贴已打开（可标记划线 / OCR / 翻译）</p>
      <p v-if="diagnostics.length" class="guide-detail log">
        {{ diagnostics.slice(-3).join('\n') }}
      </p>
      <ZButton type="primary" @click="capture">再截一张</ZButton>
    </div>
  </div>
</template>

<style scoped>
.page {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.state-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 32px;
  max-width: 420px;
  text-align: center;
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
  white-space: pre-wrap;
}
.guide-detail.log {
  color: #909399;
  text-align: left;
  max-height: 120px;
  overflow: auto;
}
.guide-actions {
  display: flex;
  gap: 12px;
}
</style>
