<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  value: { type: String, default: '' },
  display: { type: Boolean, default: false },
})

const renderedHtml = ref('')
let renderGeneration = 0

/**
 * 转义公式原文，供 KaTeX 尚未加载或解析失败时安全展示。
 * @param {unknown} value 原始公式文本。
 * @returns {string} 已转义的 HTML 文本。
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
 * 公式实际出现后按需加载 KaTeX 和字体样式并生成受控 HTML。
 * @returns {Promise<void>} 当前公式完成渲染或回退后结束的 Promise。
 */
async function renderKatex() {
  const generation = ++renderGeneration
  renderedHtml.value = escapeHtml(props.value)
  try {
    // CSS 与执行模块共享异步边界，空会话不会下载 KaTeX 资源。
    const [{ default: katex }] = await Promise.all([
      import('katex'),
      import('katex/dist/katex.min.css'),
    ])
    if (generation !== renderGeneration) return
    renderedHtml.value = katex.renderToString(props.value, {
      displayMode: props.display,
      throwOnError: false,
      trust: false,
      strict: 'ignore',
    })
  } catch {
    if (generation === renderGeneration) renderedHtml.value = escapeHtml(props.value)
  }
}

watch([() => props.value, () => props.display], () => { void renderKatex() }, { immediate: true })
onBeforeUnmount(() => { renderGeneration += 1 })
</script>

<template>
  <span :class="display ? 'markdown-math markdown-math-display' : 'markdown-math'" v-html="renderedHtml"></span>
</template>
