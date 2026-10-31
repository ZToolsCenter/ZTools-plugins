<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import EditorFindWidget from './EditorFindWidget.vue'
import { buildHighlightHtml, scrollTextareaToMatch, type TextMatch } from '../utils/text-search'

const model = defineModel<string>({ required: true })

const props = defineProps<{
  wordWrap: boolean
  placeholder: string
  showFind: boolean
  searchQuery: string
  replaceQuery: string
  caseSensitive: boolean
  wholeWord: boolean
  useRegex: boolean
  replaceExpanded: boolean
  statusText: string
  matches: TextMatch[]
  matchIndex: number
}>()

const emit = defineEmits<{
  focus: []
  findPrevious: []
  findNext: []
  replace: []
  replaceAll: []
  closeFind: []
  searchKeydown: [event: KeyboardEvent]
  'update:searchQuery': [value: string]
  'update:replaceQuery': [value: string]
  'update:caseSensitive': [value: boolean]
  'update:wholeWord': [value: boolean]
  'update:useRegex': [value: boolean]
  'update:replaceExpanded': [value: boolean]
}>()

const textareaRef = ref<HTMLTextAreaElement | null>(null)
const highlightRef = ref<HTMLElement | null>(null)
const findWidgetRef = ref<InstanceType<typeof EditorFindWidget> | null>(null)

const highlightHtml = computed(() => {
  if (!props.showFind || !props.searchQuery) {
    return buildHighlightHtml(model.value, [], -1)
  }
  return buildHighlightHtml(model.value, props.matches, props.matchIndex)
})

const syncScroll = () => {
  if (!textareaRef.value || !highlightRef.value) return
  highlightRef.value.scrollTop = textareaRef.value.scrollTop
  highlightRef.value.scrollLeft = textareaRef.value.scrollLeft
}

const scrollToCurrentMatch = async () => {
  const textarea = textareaRef.value
  const highlight = highlightRef.value
  const match = props.matches[props.matchIndex]
  if (!textarea || !match) return

  await nextTick()

  const focusEditor = !(document.activeElement instanceof HTMLElement &&
    document.activeElement.closest('.find-widget'))

  scrollTextareaToMatch(textarea, match, highlight, { focusEditor })
  syncScroll()
}

const focusFind = () => {
  findWidgetRef.value?.focusSearch()
}

const getTextarea = () => textareaRef.value

defineExpose({ focusFind, getTextarea, syncScroll, scrollToCurrentMatch })

watch(
  () => [model.value, props.matches, props.matchIndex, props.showFind, props.searchQuery],
  () => {
    syncScroll()
  }
)
</script>

<template>
  <div class="editor-panel">
    <EditorFindWidget
      v-if="showFind"
      ref="findWidgetRef"
      :search-query="searchQuery"
      :replace-query="replaceQuery"
      :case-sensitive="caseSensitive"
      :whole-word="wholeWord"
      :use-regex="useRegex"
      :replace-expanded="replaceExpanded"
      :status-text="statusText"
      @update:search-query="emit('update:searchQuery', $event)"
      @update:replace-query="emit('update:replaceQuery', $event)"
      @update:case-sensitive="emit('update:caseSensitive', $event)"
      @update:whole-word="emit('update:wholeWord', $event)"
      @update:use-regex="emit('update:useRegex', $event)"
      @update:replace-expanded="emit('update:replaceExpanded', $event)"
      @previous="emit('findPrevious')"
      @next="emit('findNext')"
      @replace="emit('replace')"
      @replace-all="emit('replaceAll')"
      @close="emit('closeFind')"
      @search-keydown="emit('searchKeydown', $event)"
    />

    <div
      class="editor-panel__body"
      :class="{ 'editor-panel__body--nowrap': !wordWrap }"
    >
      <pre
        ref="highlightRef"
        class="editor-panel__highlight"
        aria-hidden="true"
        v-html="highlightHtml"
      />
      <textarea
        ref="textareaRef"
        v-model="model"
        class="editor-panel__textarea"
        :class="{ 'editor-panel__textarea--nowrap': !wordWrap }"
        :wrap="wordWrap ? 'soft' : 'off'"
        :placeholder="placeholder"
        spellcheck="false"
        @focus="emit('focus')"
        @scroll="syncScroll"
      />
    </div>
  </div>
</template>

<style scoped>
.editor-panel {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.editor-panel__body {
  position: relative;
  flex: 1;
  min-height: 0;
  border: 1px solid #ddd;
  border-radius: 7px;
  overflow: hidden;
  background: #fff;
}

.editor-panel__highlight,
.editor-panel__textarea {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 12px;
  border: none;
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.5;
  box-sizing: border-box;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.editor-panel__body--nowrap .editor-panel__highlight,
.editor-panel__textarea--nowrap {
  white-space: pre;
  word-break: normal;
}

.editor-panel__highlight {
  pointer-events: none;
  z-index: 0;
  color: transparent;
  background: #fff;
}

.editor-panel__highlight :deep(.editor-mark) {
  color: transparent;
  background: rgba(255, 196, 76, 0.45);
  border-radius: 2px;
}

.editor-panel__highlight :deep(.editor-mark--current) {
  background: rgba(255, 128, 0, 0.75);
}

.editor-panel__textarea {
  z-index: 1;
  resize: none;
  background: transparent;
  color: inherit;
}

@media (prefers-color-scheme: dark) {
  .editor-panel__body,
  .editor-panel__highlight {
    background: #424242;
    border-color: #555;
  }
}
</style>
