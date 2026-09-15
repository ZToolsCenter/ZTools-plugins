<script setup>
import { computed, defineAsyncComponent, ref } from 'vue'
import { Archive, ChevronDown } from '@lucide/vue'

/**
 * 在用户展开压缩摘要时加载 Markdown 渲染组件。
 * @returns {Promise<Record<string, unknown>>} Markdown 组件模块。
 */
function loadMarkdownContentComponent() {
  return import('./MarkdownContent.vue')
}

const MarkdownContent = defineAsyncComponent({ loader: loadMarkdownContentComponent, delay: 0, suspensible: false })

const props = defineProps({ marker: { type: Object, required: true } })
const expanded = ref(false)

/**
 * 生成人类可读的压缩统计摘要。
 * @returns {string} 包含历史消息数量和估算 token 数的单行摘要。
 */
function buildCompactionSummary() {
  const items = Math.max(0, Math.round(Number(props.marker.shadowedItemCount) || 0))
  const tokens = Math.max(0, Math.round(Number(props.marker.shadowedTokenCount) || 0))
  if (items && tokens) return `已整理 ${items} 条历史消息（约 ${tokens.toLocaleString('zh-CN')} tokens）`
  if (items) return `已整理 ${items} 条历史消息`
  return props.marker.summary ? '点击查看压缩摘要' : '压缩摘要不可用'
}

const summary = computed(buildCompactionSummary)

/**
 * 同步压缩摘要的展开状态，让内容在主消息区中自然占位。
 * @param {Event} event details 元素的切换事件。
 * @returns {void} 无返回值。
 */
function handleToggle(event) {
  expanded.value = event.currentTarget.open
}
</script>

<template>
  <details class="context-compaction" :open="expanded" @toggle="handleToggle">
    <summary :aria-disabled="!marker.summary">
      <span class="context-compaction-leading">
        <ChevronDown :size="15" class="context-compaction-chevron" />
        <Archive :size="15" class="context-compaction-icon" />
      </span>
      <span class="context-compaction-title">上下文已压缩</span>
      <span class="context-compaction-separator" aria-hidden="true"></span>
      <span class="context-compaction-summary">{{ summary }}</span>
    </summary>
    <div v-if="expanded && marker.summary" class="context-compaction-body">
      <MarkdownContent :content="marker.summary" />
    </div>
  </details>
</template>
