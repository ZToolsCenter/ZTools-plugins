<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { ZButton, useToast } from 'ztools-ui'
import { LANG_OPTIONS, resolveTargetLang } from '../composables/useLang'

/**
 * 文本翻译轻量浮层（feature: text-translate，regex 入口）。
 *
 * - 进入时预填选中文本并自动触发一次翻译（走宿主默认翻译 provider）。
 * - 原文可编辑，停止输入 1s 自动重译。
 * - 目标语言 auto = 按内容推断（中→英 / 其余→中）。
 * - Enter 复制译文并退出；Esc 退出。
 */

const props = defineProps<{
  /** regex 入口选中的文本。 */
  initialText?: string
}>()

const { success, error: errorToast } = useToast()

const sourceText = ref(props.initialText ?? '')
const resultText = ref('')
const fromLang = ref('auto')
const toLang = ref('auto')
const translating = ref(false)
const errorText = ref('')

let debounceTimer: number | undefined
let seq = 0 // 防过期响应覆盖新结果

async function translate(): Promise<void> {
  const text = sourceText.value.trim()
  if (!text) {
    resultText.value = ''
    return
  }
  const mySeq = ++seq
  translating.value = true
  errorText.value = ''
  try {
    const to = toLang.value === 'auto' ? resolveTargetLang(text) : toLang.value
    const opts: { from?: string; to?: string } = { to }
    if (fromLang.value !== 'auto') opts.from = fromLang.value
    const out = await window.ztools.translate(text, opts)
    if (mySeq !== seq) return // 已有更新请求
    resultText.value = out?.text ?? ''
  } catch (err: any) {
    if (mySeq !== seq) return
    errorText.value = err?.message ? String(err.message) : String(err)
    errorToast('翻译失败：' + errorText.value)
  } finally {
    if (mySeq === seq) translating.value = false
  }
}

// 原文变化：停止输入 1s 自动重译
watch(sourceText, () => {
  window.clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(translate, 1000)
})

// 语言变化：立即重译
watch([fromLang, toLang], () => translate())

function swapLangs(): void {
  if (toLang.value === 'auto') return
  const f = fromLang.value === 'auto' ? (toLang.value === 'zh-CN' ? 'en' : 'zh-CN') : fromLang.value
  fromLang.value = toLang.value
  toLang.value = f
  // 同时互换文本，符合「反向翻译」直觉
  if (resultText.value) {
    sourceText.value = resultText.value
  }
}

function copyResult(): void {
  if (!resultText.value) return
  window.ztools.copyText(resultText.value)
  success('已复制译文')
}

function copyAndExit(): void {
  if (!resultText.value) return
  window.ztools.copyText(resultText.value)
  try {
    window.ztools.outPlugin()
  } catch (_) {
    /* ignore */
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
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    // 原文框内 Enter 换行（Shift+Enter），裸 Enter 在框外才触发复制退出
    const target = e.target as HTMLElement
    if (target?.tagName === 'TEXTAREA') return
    e.preventDefault()
    copyAndExit()
  } else if (e.key === 'Escape') {
    try {
      window.ztools.outPlugin()
    } catch (_) {
      /* ignore */
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  if (sourceText.value) translate()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.clearTimeout(debounceTimer)
})
</script>

<template>
  <div class="text-page">
    <!-- 顶栏：语言选择（高对比） + 设置入口 -->
    <div class="toolbar">
      <label class="lang-wrap">
        <span class="lang-label">从</span>
        <select v-model="fromLang" class="lang-native" aria-label="源语言">
          <option v-for="o in LANG_OPTIONS" :key="'f-' + o.value" :value="o.value">
            {{ o.label }}
          </option>
        </select>
      </label>
      <ZButton class="swap-btn" @click="swapLangs">⇄</ZButton>
      <label class="lang-wrap">
        <span class="lang-label">到</span>
        <select v-model="toLang" class="lang-native" aria-label="目标语言">
          <option v-for="o in LANG_OPTIONS" :key="'t-' + o.value" :value="o.value">
            {{ o.label }}
          </option>
        </select>
      </label>
      <span v-if="translating" class="status">翻译中…</span>
      <button type="button" class="settings-btn" title="提供商设置" @click="openSettings">⚙</button>
    </div>

    <!-- 左右对照 -->
    <div class="panes">
      <div class="pane">
        <div class="pane-label">原文</div>
        <textarea
          v-model="sourceText"
          class="pane-text source"
          placeholder="输入或粘贴要翻译的文本…"
        />
      </div>
      <div class="pane">
        <div class="pane-label">
          译文
          <ZButton size="small" class="copy-btn" :disabled="!resultText" @click="copyResult">
            ⧉ 复制
          </ZButton>
        </div>
        <div class="pane-text result" :class="{ empty: !resultText }">
          {{ resultText || (translating ? '' : '译文将显示在这里') }}
        </div>
      </div>
    </div>

    <div class="hint">Enter 复制译文并退出 · Esc 退出 · 停止输入 1s 自动重译</div>
  </div>
</template>

<style scoped>
.text-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 12px 16px;
  box-sizing: border-box;
  gap: 10px;
}


.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.lang-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.lang-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--z-text-color, #303133);
  opacity: 0.85;
}

/* 原生 select：深/浅色都保证文字与背景对比清晰 */
.lang-native {
  min-width: 132px;
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--z-border-color, #c0c4cc);
  border-radius: 6px;
  background: var(--z-bg-color, #fff);
  color: var(--z-text-color, #1f2329);
  font-size: 13px;
  outline: none;
  cursor: pointer;
}

.lang-native:focus {
  border-color: var(--primary-color, #409eff);
  box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.2);
}

.lang-native option {
  background: #fff;
  color: #1f2329;
}

:global(html.dark) .lang-native,
:global(.dark) .lang-native {
  background: #2b2d31;
  color: #e8e8e8;
  border-color: #4c4f56;
}

:global(html.dark) .lang-native option,
:global(.dark) .lang-native option {
  background: #2b2d31;
  color: #e8e8e8;
}

.swap-btn {
  padding: 0 10px;
}

.status {
  font-size: 12px;
  color: var(--z-text-color-secondary, #909399);
}

.settings-btn {
  margin-left: auto;
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

.pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.pane-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--z-text-color-secondary, #909399);
}

.pane-text {
  flex: 1;
  border: 1px solid var(--z-border-color, #dcdfe6);
  border-radius: 6px;
  padding: 10px;
  font-size: 14px;
  line-height: 1.6;
  overflow: auto;
  background: transparent;
  color: inherit;
  box-sizing: border-box;
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
}

.result.empty {
  color: var(--z-text-color-secondary, #909399);
}

.hint {
  font-size: 12px;
  color: var(--z-text-color-secondary, #909399);
  text-align: center;
}
</style>
