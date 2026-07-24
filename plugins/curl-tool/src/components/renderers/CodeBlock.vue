<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { ContentKind } from '../../utils/content'
import { highlightCode } from '../../utils/content'

const props = defineProps<{
  content: string
  kind: ContentKind | 'plain'
  query?: string
  activeIndex?: number
  editable?: boolean
  showLineNumbers?: boolean
}>()

const emit = defineEmits<{
  'update:content': [value: string]
}>()

const rootRef = ref<HTMLElement | null>(null)
const highlightHtml = ref('')
const focused = ref(false)
let renderTimer = 0

watch(
  () => [props.content, props.kind, props.query, props.activeIndex],
  () => scheduleHighlight(),
  { immediate: true }
)

watch(
  () => [props.query, props.activeIndex],
  () => nextTick(scrollToActiveMatch)
)

function syncScroll(event: Event) {
  const textarea = event.target as HTMLTextAreaElement
  const preview = textarea.previousElementSibling as HTMLElement | null
  if (!preview) return
  preview.scrollTop = textarea.scrollTop
  preview.scrollLeft = textarea.scrollLeft
}

function scheduleHighlight() {
  window.clearTimeout(renderTimer)
  renderTimer = window.setTimeout(() => {
    const html = highlightCode(props.content, props.kind, props.query || '', props.activeIndex || 0)
    highlightHtml.value = props.showLineNumbers === false ? html : withLineNumbers(html)
    nextTick(scrollToActiveMatch)
  }, props.editable ? 120 : 0)
}

function scrollToActiveMatch() {
  rootRef.value?.querySelector('.search-hit.active')?.scrollIntoView({ block: 'center', inline: 'nearest' })
}

onBeforeUnmount(() => window.clearTimeout(renderTimer))

function withLineNumbers(html: string) {
  const lines = html.split('\n')
  return lines
    .map((line, index) => {
      const content = line || ' '
      return `<span class="code-line"><span class="code-line-no">${index + 1}</span><span class="code-line-content">${content}</span></span>`
    })
    .join('')
}
</script>

<template>
  <div ref="rootRef" class="code-block" :class="{ editable, focused, 'no-line-numbers': showLineNumbers === false }">
    <pre class="code-highlight" :class="{ ghost: editable && focused }" v-html="highlightHtml"></pre>
    <textarea
      v-if="editable"
      :value="content"
      spellcheck="false"
      @input="emit('update:content', ($event.target as HTMLTextAreaElement).value)"
      @scroll="syncScroll"
      @focus="focused = true"
      @blur="focused = false"
    />
  </div>
</template>

<style scoped>
.code-block {
  height: 100%;
  min-height: 100%;
  box-sizing: border-box;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  overflow: auto;
}

.code-block.editable {
  position: relative;
  min-height: 120px;
  background: #fff;
  overflow: hidden;
}

.code-block.editable.focused {
  border-color: #e2e8f0;
  background: #fff;
}

.code-highlight {
  min-height: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 13px 14px 18px;
  color: #243044;
  font-family: Consolas, 'SFMono-Regular', monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.editable .code-highlight {
  position: absolute;
  inset: 0;
  padding: 12px;
  overflow: hidden;
  pointer-events: none;
}

.editable .code-highlight.ghost {
  visibility: hidden;
}

textarea {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  min-height: 120px;
  box-sizing: border-box;
  padding: 12px;
  border: 0;
  color: transparent;
  background: transparent;
  caret-color: #0f172a;
  font-family: Consolas, 'SFMono-Regular', monospace;
  font-size: 12px;
  line-height: 1.6;
  outline: none;
  resize: none;
}

.focused textarea {
  color: #0f172a;
  background: #fff;
}
</style>

<style>
.code-token-key {
  color: #7c3aed;
}

.code-token-string {
  color: #00875a;
}

.code-token-number {
  color: #d97706;
}

.code-token-literal,
.code-token-tag {
  color: #2563eb;
}

.code-token-attr {
  color: #c026d3;
}

.code-token-comment {
  color: #94a3b8;
}

.search-hit {
  border-radius: 3px;
  background: #fde68a;
  color: inherit;
}

.search-hit.active {
  background: #f59e0b;
  color: #111827;
}

.code-line {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  min-height: 19px;
}

.code-line-no {
  padding-right: 12px;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
  text-align: right;
  user-select: none;
}

.code-line-content {
  min-width: 0;
}
</style>
