<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useToast } from 'ztools-ui'
import { LANG_OPTIONS, loadSavedFromLang, loadSavedTargetLang, persistLangPair } from '../composables/useLang'
import { translateLines, prettyProviderName } from '../composables/useOcrTranslate'

/**
 * 只 OCR / OCR 翻译 主窗结果。
 * - mode='ocr'：单栏原文，可选手动翻译
 * - mode='ocr-translate'：左右两栏对照
 */
const props = defineProps<{
  mode: 'ocr' | 'ocr-translate'
  lines: SnapLine[]
  translateOk?: boolean
  translateError?: string
  targetLang?: string
  detectedFrom?: string
  ocrProvider?: string
  translateProvider?: string
}>()

const emit = defineEmits<{
  (e: 'again'): void
  (e: 'exit'): void
}>()

const { success, error: errorToast } = useToast()

const viewMode = ref(props.mode)
const fromLang = ref(loadSavedFromLang() || 'auto')
const toLang = ref(props.targetLang || loadSavedTargetLang() || 'auto')
const translating = ref(false)
const sourceText = ref(props.lines.map((l) => l.text).join('\n'))
const translatedLines = ref<SnapLine[]>(props.lines.slice())
const lastError = ref(props.translateError || '')
const liveTranslateProvider = ref(props.translateProvider || '')
const liveDetectedFrom = ref(props.detectedFrom || '')
const liveTargetLang = ref(props.targetLang || '')
const resultText = computed(() =>
  translatedLines.value.map((l) => l.translated || '').join('\n')
)
const showTranslation = computed(() => viewMode.value === 'ocr-translate')
/** 底部低调引擎角标。 */
const engineHint = computed(() => {
  const parts: string[] = []
  if (props.ocrProvider) parts.push(prettyProviderName(props.ocrProvider))
  if (showTranslation.value && liveTranslateProvider.value) {
    parts.push(prettyProviderName(liveTranslateProvider.value))
  }
  return parts.join(' · ')
})

watch(
  () => props.lines,
  (ls) => {
    sourceText.value = ls.map((l) => l.text).join('\n')
    translatedLines.value = ls.slice()
  }
)
watch(
  () => props.mode,
  (m) => {
    viewMode.value = m
  }
)
watch(
  () => props.translateProvider,
  (p) => {
    liveTranslateProvider.value = p || ''
  }
)

async function doTranslate(): Promise<void> {
  const blocks = sourceText.value.split('\n').map((s) => s.trim()).filter(Boolean)
  if (!blocks.length) return
  persistLangPair(fromLang.value, toLang.value)
  translating.value = true
  lastError.value = ''
  try {
    const r = await translateLines(blocks, toLang.value, fromLang.value)
    translatedLines.value = r.lines
    viewMode.value = 'ocr-translate'
    liveTranslateProvider.value = r.translateProvider || ''
    liveDetectedFrom.value = r.detectedFrom || ''
    liveTargetLang.value = r.targetLang || toLang.value
    if (!r.translateOk) {
      lastError.value = r.translateError || '翻译不可用'
      errorToast(lastError.value)
    } else {
      success('翻译完成')
    }
  } catch (e: any) {
    lastError.value = e?.message ? String(e.message) : String(e)
    errorToast(lastError.value)
  } finally {
    translating.value = false
  }
}

function copyText(text: string, tip = '已复制'): void {
  if (!text) return
  try {
    window.ztools.copyText(text)
    success(tip)
  } catch (_) {
    errorToast('复制失败')
  }
}

function openSettings(): void {
  try {
    window.ztools.redirect('截图翻译设置', '')
  } catch (_) {
    errorToast('无法打开设置，请搜索「截图翻译设置」')
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('exit')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="ocr-result">
    <div class="toolbar">
      <span class="title">{{ showTranslation ? 'OCR 翻译对照' : 'OCR 识别结果' }}</span>
      <label class="lang-wrap">
        <span class="lang-label">从</span>
        <select v-model="fromLang" class="lang-native" aria-label="源语言">
          <option v-for="o in LANG_OPTIONS" :key="'f-' + o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </label>
      <label class="lang-wrap">
        <span class="lang-label">到</span>
        <select v-model="toLang" class="lang-native" aria-label="目标语言">
          <option v-for="o in LANG_OPTIONS" :key="'t-' + o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </label>
      <button
        type="button"
        class="copy-solid copy-trans"
        :disabled="translating || !sourceText.trim()"
        @click="doTranslate"
      >
        {{ translating ? '翻译中…' : '翻译' }}
      </button>
      <span v-if="liveDetectedFrom && showTranslation" class="meta">{{ liveDetectedFrom }} → {{ liveTargetLang || toLang }}</span>
      <span v-else-if="showTranslation && !translateOk && lastError" class="degraded">⚠ {{ lastError }}</span>
      <div class="actions">
        <button type="button" class="settings-btn" title="提供商设置" @click="openSettings">⚙</button>
      </div>
    </div>

    <div class="panes" :class="{ single: !showTranslation }">
      <div class="pane">
        <div class="pane-label">
          <span>原文</span>
          <button type="button" class="copy-solid" @click="copyText(sourceText, '已复制原文')">
            复制原文
          </button>
        </div>
        <textarea v-model="sourceText" class="pane-text source" spellcheck="false" />
      </div>
      <div v-if="showTranslation" class="pane">
        <div class="pane-label">
          <span>译文</span>
          <button
            type="button"
            class="copy-solid copy-trans"
            :disabled="!resultText"
            @click="copyText(resultText, '已复制译文')"
          >
            复制译文
          </button>
        </div>
        <div class="pane-text result" :class="{ empty: !resultText }">
          {{ resultText || lastError || '译文将显示在这里' }}
        </div>
      </div>
    </div>

    <div class="foot">
      <span class="hint">
        <span v-if="engineHint" class="engine-hint">{{ engineHint }}</span>
        <span>Esc 退出 · 可选源/目标语言后点翻译</span>
      </span>
      <div class="foot-actions">
        <button type="button" class="action-btn primary" @click="emit('again')">再截一张</button>
        <button type="button" class="action-btn" @click="emit('exit')">退出</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ocr-result {
  height: 100%;
  width: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  padding: 12px 16px;
  gap: 10px;
  background: var(--z-bg-color, #fff);
  color: var(--z-text-color, #303133);
}


.toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.title {
  font-size: 14px;
  font-weight: 600;
}

.meta {
  font-size: 12px;
  color: var(--z-text-color-secondary, #909399);
}

.degraded {
  font-size: 12px;
  color: #e6a23c;
}

.lang-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.lang-label {
  font-size: 12px;
  font-weight: 600;
  color: #111827;
}

:global(html.dark) .lang-label {
  color: #f8fafc;
}

.lang-native {
  min-width: 118px;
  height: 28px;
  padding: 0 6px;
  border: 1px solid #c0c4cc;
  border-radius: 6px;
  background: #ffffff;
  color: #111827;
  font-size: 12px;
  font-weight: 600;
}

:global(html.dark) .lang-native {
  background: #2b2d31;
  color: #e8e8e8;
  border-color: #4c4f56;
}

.actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.settings-btn {
  width: 32px;
  height: 32px;
  border: 1px solid var(--z-border-color, #dcdfe6);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 14px;
}

.settings-btn:hover {
  border-color: var(--primary-color, #409eff);
  color: var(--primary-color, #409eff);
}

.panes {
  flex: 1;
  display: flex;
  gap: 12px;
  min-height: 0;
}

.panes.single .pane {
  flex: 1;
}

.pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.pane-label {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
  color: #111827;
}

:global(html.dark) .pane-label {
  color: #f8fafc;
}

.pane-text {
  flex: 1;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 10px;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.65;
  overflow: auto;
  background: #ffffff;
  color: #111827;
  box-sizing: border-box;
  min-height: 0;
  -webkit-font-smoothing: antialiased;
}

:global(html.dark) .pane-text {
  border-color: #3f4550;
  background: #23262b;
  color: #f8fafc;
}

.copy-solid {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: #111827;
  color: #ffffff;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.02em;
  cursor: pointer;
  -webkit-font-smoothing: antialiased;
  text-shadow: none;
  filter: none;
}

.copy-solid:hover:not(:disabled) {
  background: #1f2937;
  color: #ffffff;
}

.copy-solid.copy-trans {
  background: #0b3d73;
  color: #ffffff;
}

.copy-solid.copy-trans:hover:not(:disabled) {
  background: #0a4d90;
  color: #ffffff;
}

.copy-solid:disabled {
  background: #6b7280;
  color: #ffffff;
  opacity: 1;
  cursor: not-allowed;
}

:global(html.dark) .copy-solid {
  background: #f8fafc;
  color: #0f172a;
}

:global(html.dark) .copy-solid:hover:not(:disabled) {
  background: #e2e8f0;
  color: #0f172a;
}

:global(html.dark) .copy-solid.copy-trans {
  background: #7dd3fc;
  color: #082f49;
}

:global(html.dark) .copy-solid.copy-trans:hover:not(:disabled) {
  background: #bae6fd;
  color: #082f49;
}

.source {
  resize: none;
  outline: none;
  font-family: inherit;
}

.source:focus {
  border-color: var(--primary-color, #409eff);
}

.result {
  white-space: pre-wrap;
  word-break: break-word;
  color: #0b3d73;
  background: #f3f8ff;
}

:global(html.dark) .result {
  color: #dbeafe;
  background: #1a2433;
}

.result.empty {
  color: #6b7280;
  background: #f8fafc;
}

:global(html.dark) .result.empty {
  color: #94a3b8;
  background: #23262b;
}

.foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.hint {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--z-text-color-secondary, #909399);
}

.engine-hint {
  font-size: 10px;
  color: #9ca3af;
  user-select: none;
}

:global(html.dark) .engine-hint {
  color: #6b7280;
}

.foot-actions {
  display: flex;
  gap: 8px;
}

/* 实心底 + 实字色：避免透明继承发糊 */
.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  padding: 0 14px;
  border: none;
  border-radius: 6px;
  background: #111827;
  color: #ffffff;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  -webkit-font-smoothing: antialiased;
}

.action-btn:hover {
  background: #1f2937;
}

.action-btn.primary {
  background: #0b3d73;
  color: #ffffff;
}

.action-btn.primary:hover {
  background: #0a4d90;
}

:global(html.dark) .action-btn {
  background: #f8fafc;
  color: #0f172a;
}

:global(html.dark) .action-btn:hover {
  background: #e2e8f0;
}

:global(html.dark) .action-btn.primary {
  background: #7dd3fc;
  color: #082f49;
}

:global(html.dark) .action-btn.primary:hover {
  background: #bae6fd;
}
</style>
