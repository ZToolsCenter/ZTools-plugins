<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { LANG_OPTIONS, loadSavedFromLang, loadSavedTargetLang, persistLangPair } from '../composables/useLang'
import { prettyProviderName } from '../composables/useOcrTranslate'

/**
 * 贴图旁简洁结果框（无边框子窗口）。
 * OCR：单栏原文 + 复制原文
 * 翻译：左右两栏 + 复制原文 / 复制译文
 */

const loaded = ref(false)
const payload = ref<SnapResultPayload | null>(null)
const copyTip = ref('')
const fromLang = ref('auto')
const toLang = ref('auto')
let copyTipTimer: number | undefined

const lines = computed(() => payload.value?.lines ?? [])
const hasTranslation = computed(() => !!payload.value?.translateOk)
const sourceText = computed(() => lines.value.map((l) => l.text).join('\n'))
const translatedText = computed(() =>
  lines.value.map((l) => l.translated || l.text).join('\n')
)
/** 底部低调引擎角标：OCR · 翻译。 */
const engineHint = computed(() => {
  const p = payload.value
  if (!p) return ''
  const parts: string[] = []
  if (p.ocrProvider) parts.push(prettyProviderName(p.ocrProvider))
  if (p.translateOk && p.translateProvider) parts.push(prettyProviderName(p.translateProvider))
  return parts.join(' · ')
})

function applyTheme(isDark: boolean): void {
  document.documentElement.classList.toggle('dark', isDark)
}

function load(data: SnapResultPayload): void {
  payload.value = data
  loaded.value = true
  applyTheme(data.isDark)
  fromLang.value = loadSavedFromLang() || 'auto'
  toLang.value = data.targetLang || loadSavedTargetLang() || 'auto'
}

function showCopyTip(text: string): void {
  copyTip.value = text
  window.clearTimeout(copyTipTimer)
  copyTipTimer = window.setTimeout(() => (copyTip.value = ''), 1500)
}

function copy(text: string, tip = '已复制'): void {
  if (!text) return
  navigator.clipboard
    ?.writeText(text)
    .then(() => showCopyTip(tip))
    .catch(() => showCopyTip('复制失败'))
}

function copyAllSource(): void {
  copy(sourceText.value, '已复制原文')
}

function copyAllTranslated(): void {
  copy(translatedText.value, '已复制译文')
}

function requestTranslate(): void {
  const sourceLines = lines.value.map((l) => l.text).filter(Boolean)
  if (!sourceLines.length) return
  persistLangPair(fromLang.value, toLang.value)
  showCopyTip('翻译中…')
  try {
    window.ztools?.sendToParent?.('snap-board', {
      action: 'translate',
      sourceLines,
      from: fromLang.value,
      to: toLang.value
    })
  } catch (_) {
    showCopyTip('无法翻译')
  }
}

function closeWindow(): void {
  window.close()
}

function openSettings(): void {
  try {
    window.ztools?.sendToParent?.('snap-board', { action: 'open-settings' })
    return
  } catch (_) {
    /* fallthrough */
  }
  try {
    if (typeof window.ztools?.redirect === 'function') {
      window.ztools.redirect('截图翻译设置', '')
      return
    }
  } catch (_) {
    /* ignore */
  }
  showCopyTip('请搜索「截图翻译设置」')
}

onMounted(() => {
  window.__loadSnapResult = (data: SnapResultPayload) => load(data)
})
</script>

<template>
  <div class="result-root">
    <header class="titlebar">
      <div class="title-left">
        <img v-if="payload?.logo" :src="payload.logo" class="title-logo" alt="" />
        <span class="title-text">{{ hasTranslation ? '翻译' : 'OCR' }}</span>
        <span v-if="copyTip" class="copy-tip">{{ copyTip }}</span>
      </div>
      <div class="title-right">
        <button class="win-btn settings" title="提供商设置" @click="openSettings">⚙</button>
        <button class="win-btn close" title="关闭" @click="closeWindow">✕</button>
      </div>
    </header>

    <div v-if="!loaded" class="loading">
      <div class="spinner" />
      <p>正在加载…</p>
    </div>

    <main v-else class="content">
      <div v-if="lines.length === 0" class="empty">未识别到文字</div>

      <div v-else class="panes" :class="{ split: hasTranslation }">
        <section class="pane">
          <div class="pane-head">
            <span class="pane-label">原文</span>
            <button type="button" class="copy-solid" @click="copyAllSource">复制原文</button>
          </div>
          <div class="pane-body">{{ sourceText }}</div>
        </section>
        <section v-if="hasTranslation" class="pane">
          <div class="pane-head">
            <span class="pane-label">译文</span>
            <button type="button" class="copy-solid copy-trans" @click="copyAllTranslated">
              复制译文
            </button>
          </div>
          <div class="pane-body tl">{{ translatedText }}</div>
        </section>
      </div>

      <div v-if="!hasTranslation && lines.length" class="popup-actions">
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
        <button type="button" class="copy-solid copy-trans" @click="requestTranslate">翻译</button>
      </div>

      <p v-if="engineHint" class="engine-hint">{{ engineHint }}</p>
    </main>
  </div>
</template>

<style scoped>
.result-root {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #f4f5f7;
  color: #111827;
}

:global(html.dark) .result-root {
  background: #1b1d21;
  color: #f1f5f9;
}

.titlebar {
  height: 36px;
  flex: 0 0 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 0 12px;
  -webkit-app-region: drag;
  border-bottom: 1px solid #d8dce3;
  box-sizing: border-box;
  background: #ffffff;
}

:global(html.dark) .titlebar {
  background: #23262b;
  border-bottom-color: #3a3e46;
}

.title-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.title-logo {
  width: 16px;
  height: 16px;
  border-radius: 4px;
}

.title-text {
  font-size: 13px;
  font-weight: 700;
  color: #111827;
}

:global(html.dark) .title-text {
  color: #f8fafc;
}

.title-right {
  display: flex;
  align-items: center;
  gap: 4px;
  -webkit-app-region: no-drag;
}

.copy-tip {
  font-size: 12px;
  font-weight: 600;
  color: #0b3d73;
}

:global(html.dark) .copy-tip {
  color: #7dd3fc;
}

.win-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: #e8eaee;
  color: #111827;
  font-size: 13px;
  border-radius: 6px;
  cursor: pointer;
  -webkit-app-region: no-drag;
}

:global(html.dark) .win-btn {
  background: #3a3e46;
  color: #f8fafc;
}

.win-btn:hover {
  background: #d5d9e0;
}

:global(html.dark) .win-btn:hover {
  background: #4b515c;
}

.win-btn.close:hover {
  background: #e81123;
  color: #fff;
}

.loading,
.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #4b5563;
  font-size: 13px;
}

:global(html.dark) .loading,
:global(html.dark) .empty {
  color: #cbd5e1;
}

.spinner {
  width: 22px;
  height: 22px;
  border: 3px solid #d1d5db;
  border-top-color: #0b3d73;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 10px;
}

.panes {
  flex: 1;
  display: flex;
  gap: 8px;
  min-height: 0;
}

.panes.split .pane {
  flex: 1;
}

.pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  overflow: hidden;
  background: #ffffff;
}

:global(html.dark) .pane {
  border-color: #3f4550;
  background: #23262b;
}

.pane-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  background: #eef0f4;
  border-bottom: 1px solid #d1d5db;
}

:global(html.dark) .pane-head {
  background: #2c3038;
  border-bottom-color: #3f4550;
}

.pane-label {
  font-size: 12px;
  font-weight: 700;
  color: #111827;
}

:global(html.dark) .pane-label {
  color: #f8fafc;
}

.pane-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
  color: #111827;
  background: #ffffff;
  -webkit-font-smoothing: antialiased;
}

:global(html.dark) .pane-body {
  color: #f8fafc;
  background: #23262b;
}

.pane-body.tl {
  color: #0b3d73;
  background: #f3f8ff;
}

:global(html.dark) .pane-body.tl {
  color: #dbeafe;
  background: #1a2433;
}

/* 实心底、实字色：避免透明底 + inherit 发糊 */
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

.popup-actions {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 8px;
}

.lang-wrap {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.lang-label {
  font-size: 12px;
  font-weight: 700;
  color: #111827;
}

:global(html.dark) .lang-label {
  color: #f8fafc;
}

.lang-native {
  min-width: 108px;
  height: 28px;
  padding: 0 4px;
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

.popup-actions .copy-solid {
  height: 32px;
  min-width: 88px;
  padding: 0 16px;
  font-size: 13px;
}

.engine-hint {
  flex: 0 0 auto;
  margin: 8px 0 0;
  padding-top: 6px;
  text-align: right;
  font-size: 10px;
  line-height: 1.2;
  color: #9ca3af;
  user-select: none;
}

:global(html.dark) .engine-hint {
  color: #6b7280;
}
</style>
