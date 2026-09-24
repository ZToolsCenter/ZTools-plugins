<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { writeClipboard } from '../utils/clipboard.js'

const props = defineProps({
  code: { type: String, default: '' },
  language: { type: String, default: '' },
  streaming: { type: Boolean, default: false },
})

const copied = ref(false)
const renderedHtml = ref('')
let copiedTimer = 0
let renderGeneration = 0

/**
 * 将代码文本转义为可安全放入代码块的 HTML。
 * @param {string} value 原始代码文本。
 * @returns {string} 已转义的代码 HTML。
 */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
}

/**
 * 规范化 Markdown 围栏语言，避免将任意模型文本当作 highlight.js 语言名。
 * @param {string} value Markdown 围栏语言。
 * @returns {string} 可查询的语言名；无效时返回空字符串。
 */
function normalizeLanguage(value) {
  const language = String(value || '').trim().toLowerCase().split(/[\s,]+/)[0]
  return /^[a-z0-9_+-]+$/.test(language) ? language : ''
}

const normalizedLanguage = computed(() => normalizeLanguage(props.language))

/**
 * 先显示安全纯文本，再在需要时异步加载精简高亮模块。
 * @returns {Promise<void>} 当前代码版本完成高亮或回退后结束的 Promise。
 */
async function renderCode() {
  const generation = ++renderGeneration
  const source = String(props.code || '')
  renderedHtml.value = escapeHtml(source)
  if (props.streaming || !normalizedLanguage.value) return
  try {
    // 代码块实际出现后才加载高亮器，空会话首屏无需解析语言定义。
    const { highlightCode } = await import('../utils/code-highlighter.js')
    if (generation !== renderGeneration) return
    renderedHtml.value = highlightCode(source, normalizedLanguage.value) || escapeHtml(source)
  } catch {
    if (generation === renderGeneration) renderedHtml.value = escapeHtml(source)
  }
}

watch([() => props.code, () => props.language, () => props.streaming], () => { void renderCode() }, { immediate: true })

/**
 * 复制当前代码块，并在短时间内显示完成状态。
 * @returns {Promise<void>} 复制操作完成后结束的 Promise。
 */
async function copyCode() {
  const succeeded = await writeClipboard(String(props.code || ''))
  if (!succeeded) return
  copied.value = true
  window.clearTimeout(copiedTimer)
  copiedTimer = window.setTimeout(() => { copied.value = false }, 1000)
}

onBeforeUnmount(() => {
  renderGeneration += 1
  window.clearTimeout(copiedTimer)
})
</script>

<template>
  <div class="markdown-code-block">
    <div class="markdown-code-header">
      <span>{{ normalizedLanguage || 'text' }}</span>
      <button type="button" @click="copyCode">{{ copied ? '已复制' : '复制' }}</button>
    </div>
    <pre><code :class="normalizedLanguage ? `language-${normalizedLanguage}` : ''" v-html="renderedHtml"></code></pre>
  </div>
</template>
