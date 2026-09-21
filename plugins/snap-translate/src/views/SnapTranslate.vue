<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ZButton, useToast } from 'ztools-ui'
import {
  ocrTranslate,
  OcrUnavailableError
} from '../composables/useOcrTranslate'
import { openResultWindow } from '../composables/useResultWindow'

/**
 * 截图翻译主编排（feature: snap-translate）。
 *
 * 主窗口只做「编排」：截屏 → OCR → 翻译 → 开结果窗 → 注入 → outPlugin 退出。
 * 展示全部在子窗口完成（子窗口不带 preload，只做展示）。
 *
 * 流程（每次进入触发，App.vue 用 :key 重建实例保证状态不残留）：
 *   1. ztools.screenCapture 自动调起系统截屏；Esc 取消 → 静默退出。
 *   2. 截图回调返回 base64 → ocrTranslate 管线（OCR → 翻译，内含降级）。
 *   3. OCR 不可用 → 展示「安装 OCR 提供商」引导卡（可重试）。
 *   4. 成功（含翻译降级/0 行）→ openResultWindow 注入数据 → outPlugin。
 */

type Phase = 'idle' | 'capturing' | 'processing' | 'done' | 'ocr-missing' | 'error'

const { success, error: errorToast, info: infoToast } = useToast()

const phase = ref<Phase>('idle')
const errorText = ref('')

const busy = computed(() => phase.value === 'capturing' || phase.value === 'processing')

function capture(): void {
  if (busy.value) return
  phase.value = 'capturing'
  errorText.value = ''

  window.ztools.screenCapture((imgBase64: string) => {
    // 用户 Esc 取消截屏：静默退出插件，不报错
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
    const result = await ocrTranslate(image)
    if (result.diagnostics?.length) {
      console.info('[snap-translate] diagnostics\n' + result.diagnostics.join('\n'))
    }

    if (result.lines.length === 0) {
      infoToast('未识别到文字')
    } else if (!result.translateOk) {
      infoToast('翻译不可用：' + (result.translateError || '已降级为纯识别'))
      console.error('[snap-translate] translate unavailable', result.translateError, result.diagnostics)
    } else {
      success(
        `识别 ${result.lines.length} 行，翻译完成` +
          (result.translateProvider ? ` (${result.translateProvider})` : '')
      )
    }

    const ok = openResultWindow({
      image,
      lines: result.lines,
      targetLang: result.targetLang,
      detectedFrom: result.detectedFrom,
      isDark: window.ztools.isDarkColors(),
      logo: window.services.pluginLogoDataUrl(),
      translateOk: result.translateOk,
      translateError: result.translateError,
      diagnostics: result.diagnostics,
      translateProvider: result.translateProvider
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
      // 无默认 OCR provider：展示引导卡
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
  <div class="snap-page">
    <!-- 截屏中 / 识别翻译中：过渡态 -->
    <div v-if="busy" class="state-block">
      <div class="spinner" />
      <p class="state-text">
        {{ phase === 'capturing' ? '请框选屏幕区域…（Esc 取消）' : '正在识别并翻译…' }}
      </p>
    </div>

    <!-- OCR provider 缺失：引导卡 -->
    <div v-else-if="phase === 'ocr-missing'" class="state-block guide">
      <p class="guide-title">⚠ 未找到可用的 OCR 提供商</p>
      <p class="guide-text">
        请在本插件「截图翻译设置」配置 OCR（微信引擎或 Paddle），
        然后在宿主「设置 → 提供商」中设为默认。
      </p>
      <p v-if="errorText" class="guide-detail">{{ errorText }}</p>
      <div class="guide-actions">
        <ZButton type="primary" @click="capture">重试</ZButton>
        <ZButton @click="exit">退出</ZButton>
      </div>
    </div>

    <!-- 其它错误 -->
    <div v-else-if="phase === 'error'" class="state-block guide">
      <p class="guide-title">出错了</p>
      <p class="guide-detail">{{ errorText }}</p>
      <div class="guide-actions">
        <ZButton type="primary" @click="capture">重新截图</ZButton>
        <ZButton @click="exit">退出</ZButton>
      </div>
    </div>

    <!-- done / idle：结果在子窗口展示，此处仅兜底 -->
    <div v-else class="state-block">
      <p class="state-text">结果已在独立窗口打开</p>
      <ZButton type="primary" @click="capture">重新截图</ZButton>
    </div>
  </div>
</template>

<style scoped>
.snap-page {
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
