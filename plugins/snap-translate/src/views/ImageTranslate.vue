<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ZButton, useToast } from 'ztools-ui'
import {
  ocrTranslate,
  OcrUnavailableError
} from '../composables/useOcrTranslate'
import { openResultWindow } from '../composables/useResultWindow'

/**
 * 图片翻译（feature: image-translate，img / files 入口）。
 *
 * 与 SnapTranslate 共用同一管线，只是跳过截屏：
 *   - img 入口：payload 即 data URI，直接进管线；
 *   - files 入口：payload 是本地路径，经 preload readFileAsDataURL 转 data URI
 *     （渲染进程无法直接加载本地 path，且结果子窗口也只认 data URI）。
 */

const props = defineProps<{
  /** 归一化后的图片源：data URI 或本地路径（App.vue 提取）。 */
  imageSource: string
}>()

type Phase = 'idle' | 'processing' | 'done' | 'ocr-missing' | 'error'

const { success, error: errorToast, info: infoToast } = useToast()

const phase = ref<Phase>('idle')
const errorText = ref('')

const busy = computed(() => phase.value === 'processing')

/** 本地路径 → data URI；已是 data URI / http(s) 则原样返回。 */
function normalizeImage(src: string): string {
  if (!src) return ''
  if (src.startsWith('data:') || /^https?:\/\//i.test(src)) return src
  try {
    return window.services.readFileAsDataURL(src)
  } catch (err: any) {
    throw new Error('读取图片失败：' + (err?.message ?? String(err)))
  }
}

async function process(): Promise<void> {
  if (busy.value) return
  phase.value = 'processing'
  errorText.value = ''
  try {
    const image = normalizeImage(props.imageSource)
    if (!image) throw new Error('未获取到图片')

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
        '翻译完成' +
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
  process()
})
</script>

<template>
  <div class="image-page">
    <div v-if="busy" class="state-block">
      <div class="spinner" />
      <p class="state-text">正在识别并翻译…</p>
    </div>

    <div v-else-if="phase === 'ocr-missing'" class="state-block guide">
      <p class="guide-title">⚠ 未找到可用的 OCR 提供商</p>
      <p class="guide-text">
        请在本插件「截图翻译设置」配置 OCR，并在宿主「设置 → 提供商」设为默认。
      </p>
      <p v-if="errorText" class="guide-detail">{{ errorText }}</p>
      <div class="guide-actions">
        <ZButton type="primary" @click="process">重试</ZButton>
        <ZButton @click="exit">退出</ZButton>
      </div>
    </div>

    <div v-else-if="phase === 'error'" class="state-block guide">
      <p class="guide-title">出错了</p>
      <p class="guide-detail">{{ errorText }}</p>
      <div class="guide-actions">
        <ZButton type="primary" @click="process">重试</ZButton>
        <ZButton @click="exit">退出</ZButton>
      </div>
    </div>

    <div v-else class="state-block">
      <p class="state-text">结果已在独立窗口打开</p>
    </div>
  </div>
</template>

<style scoped>
.image-page {
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
