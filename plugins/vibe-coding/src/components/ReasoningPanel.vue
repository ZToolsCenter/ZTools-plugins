<script setup>
import { computed, defineAsyncComponent, ref } from 'vue'
import { Atom, ChevronDown } from '@lucide/vue'

/**
 * 在用户展开已完成思考时加载 Markdown 渲染组件。
 * @returns {Promise<Record<string, unknown>>} Markdown 组件模块。
 */
function loadMarkdownContentComponent() {
  return import('./MarkdownContent.vue')
}

const MarkdownContent = defineAsyncComponent({ loader: loadMarkdownContentComponent, delay: 0, suspensible: false })

const props = defineProps({
  reasoning: { type: String, default: '' },
  isStreaming: { type: Boolean, default: false },
  isThinking: { type: Boolean, default: false },
})

const expanded = ref(false)

/**
 * 根据思考流状态生成折叠行摘要，流式阶段跟随最新一行，完成后回到首行。
 * @returns {string} 当前思考块的一行摘要。
 */
function buildReasoningSummary() {
  const visible = props.reasoning.trimEnd()
  if (!visible) return props.isThinking ? '正在分析需求…' : '已完成'
  const lines = visible.split('\n').map((line) => line.trim()).filter(Boolean)
  return props.isStreaming ? lines.at(-1) : lines[0]
}

const summary = computed(buildReasoningSummary)

/**
 * 同步思考面板展开状态，让内容随主消息区自然滚动。
 * @param {Event} event details 元素的切换事件。
 * @returns {void} 无返回值。
 */
function handleToggle(event) {
  expanded.value = event.currentTarget.open
}
</script>

<template>
  <details class="reasoning-block" :class="{ 'is-running': isStreaming }" :open="expanded" @toggle="handleToggle">
    <summary>
      <span class="reasoning-leading"><ChevronDown :size="15" class="reasoning-chevron" /><Atom :size="15" class="reasoning-icon" /></span>
      <span class="reasoning-title">思考</span>
      <span class="reasoning-separator" aria-hidden="true"></span>
      <span class="reasoning-summary">{{ summary }}</span>
    </summary>
    <div v-if="expanded" class="reasoning-content">
      <div class="reasoning-rendered-content">
        <div v-if="isStreaming" class="reasoning-stream-text">{{ reasoning }}</div>
        <MarkdownContent v-else :content="reasoning" />
      </div>
    </div>
  </details>
</template>
