<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ZButton, useToast } from 'ztools-ui'
import { ocrOnly, OcrUnavailableError } from '../composables/useOcrTranslate'
import { openResultWindow } from '../composables/useResultWindow'

/**
 * 快速截图识别（feature: snap-ocr）。
 * 截屏 → 仅 OCR → 结果窗（不跑翻译，启动最快）。
 * 需要翻译时用「截图翻译」或「截图悬浮贴」。
 */

type Phase = 'idle' | 'capturing' | 'processing' | 'done' | 'ocr-missing' | 'error'

const { success, error: errorToast, info: infoToast } = useToast()

const phase = ref<Phase>('idle')
const errorText = ref('')
const diagnostics = ref<string[]>([])

const busy = computed(() => phase.value === 'capturing' || phase.value === 'processing')

function capture(): void {
  if (busy.value) return
  phase.value = 'capturing'
  errorText.value = ''

  window.ztools.screenCapture((imgBase64: string) => {
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
    process(dataUri)
  })
}

async function process(image: string): Promise<void> {
  phase.value = 'processing'
  try {
    const result = await ocrOnly(image)
    diagnostics.value = result.diagnostics
    if (result.lines.length === 0) infoToast('未识别到文字')
    else success(`识别 ${result.lines.length} 行`)

    const ok = openResultWindow({
      image,
      lines: result.lines,
      targetLang: '',
      isDark: window.ztools.isDarkColors(),
      logo: window.services.pluginLogoDataUrl(),
      translateOk: false,
      translateError: '快速识别模式未翻译（请用「截图翻译」或悬浮贴「识别+翻译」）',
      diagnostics: result.diagnostics
    })

    if (ok) {
      phase.value = 'done'
      try {
        window.ztools.outPlugin()
      } catch (_) {
        /* ignore */
      }
    } else {
      phase.value = 'error'
      errorText.value = '打开结果窗口失败'
      errorToast(errorText.value)
    }
  } catch (err: any) {
    if (err instanceof OcrUnavailableError) {
      phase.value = 'ocr-missing'
      errorText.value = err.message
    } else {
      phase.value = 'error'
      errorText.value = err?.message ? String(err.message) : String(err)
      errorToast(errorText.value)
    }
  }
}

function exit(): void {
  try {
    window.ztools.outPlugin()
  } catch (_) {
    /* ignore */
  }
}

onMounted(() => {
  capture()
})
</script>

<template>
  <div class="page">
    <div v-if="busy" class="state-block">
      <div class="spinner" />
      <p class="state-text">
        {{ phase === 'capturing' ? '请框选屏幕区域…（Esc 取消）' : '正在识别…' }}
      </p>
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
      <p class="state-text">结果已在独立窗口打开</p>
      <ZButton type="primary" @click="capture">重新截图</ZButton>
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
}
.guide-actions {
  display: flex;
  gap: 12px;
}
</style>
