<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MarkdownContent from './MarkdownContent.vue'

const props = defineProps<{
  reasoning: string
  isDark: boolean
  isStreaming: boolean
  isThinking: boolean
}>()

const scrollRef = ref<HTMLElement>()
const contentRef = ref<HTMLElement>()
const expanded = ref(props.isThinking)
const sticky = ref(true)
let resizeObserver: ResizeObserver | null = null
let observedContent: HTMLElement | null = null
let scrollRaf = 0
let forceScrollPending = false

function syncResizeObserver() {
  if (!resizeObserver) return
  if (observedContent) resizeObserver.unobserve(observedContent)
  observedContent = contentRef.value || null
  if (observedContent) resizeObserver.observe(observedContent)
}

function scheduleScrollToBottom(force = false) {
  if (!expanded.value || (!sticky.value && !force)) return
  if (force) {
    forceScrollPending = true
    sticky.value = true
  }
  if (scrollRaf) return

  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0
    const shouldForce = forceScrollPending
    forceScrollPending = false
    const el = scrollRef.value
    if (!el || !expanded.value || (!sticky.value && !shouldForce)) return
    el.scrollTop = el.scrollHeight
  })
}

function handleToggle(event: Event) {
  const isOpen = (event.currentTarget as HTMLDetailsElement).open
  expanded.value = isOpen
  if (isOpen) {
    sticky.value = true
    nextTick(() => scheduleScrollToBottom(true))
  }
}

function handleScroll() {
  const el = scrollRef.value
  if (!el) return
  sticky.value = el.scrollHeight - el.scrollTop - el.clientHeight < 24
}

watch(() => props.isThinking, (isThinking, wasThinking) => {
  if (isThinking) {
    expanded.value = true
    sticky.value = true
    nextTick(() => scheduleScrollToBottom(true))
  } else if (wasThinking) {
    expanded.value = false
  }
})

watch(expanded, async (isExpanded) => {
  await nextTick()
  syncResizeObserver()
  if (isExpanded) scheduleScrollToBottom(true)
})

watch(() => props.reasoning, () => {
  if (props.isStreaming) nextTick(() => scheduleScrollToBottom())
})

watch(() => props.isStreaming, (isStreaming) => {
  if (!isStreaming && expanded.value) {
    nextTick(() => scheduleScrollToBottom())
  }
})

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => scheduleScrollToBottom())
    syncResizeObserver()
  }
  if (expanded.value) nextTick(() => scheduleScrollToBottom(true))
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (scrollRaf) cancelAnimationFrame(scrollRaf)
})
</script>

<template>
  <details class="reasoning-block" :open="expanded" @toggle="handleToggle">
    <summary>{{ isThinking ? '思考中...' : '思考过程' }}</summary>
    <div
      v-if="expanded"
      ref="scrollRef"
      class="reasoning-content"
      @scroll="handleScroll"
      @wheel.stop
      @touchstart.stop
      @touchmove.stop
    >
      <div ref="contentRef" class="reasoning-rendered-content">
        <div v-if="isStreaming" class="reasoning-stream-text">{{ reasoning }}</div>
        <MarkdownContent v-else :markdown="reasoning" :is-dark="isDark" />
      </div>
    </div>
  </details>
</template>

<style scoped>
.reasoning-block {
  margin-bottom: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.reasoning-block summary {
  padding: 4px 8px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}
.reasoning-block summary:hover {
  background: var(--hover);
}
.reasoning-content {
  max-height: 200px;
  padding: 6px 10px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-top: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 12.5px;
}
.reasoning-rendered-content {
  width: 100%;
  min-width: 0;
}
.reasoning-stream-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}
</style>
