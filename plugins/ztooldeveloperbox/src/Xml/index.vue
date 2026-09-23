<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import XmlEditorPanel from '../components/XmlEditorPanel.vue'
import {
  collectMatches,
  replaceAllText,
  type SearchOptions,
  type TextMatch
} from '../utils/text-search'
import { compressXml, formatXml } from '../utils/xml'

const props = defineProps({
  enterAction: {
    type: Object,
    required: true
  }
})

type Panel = 'input' | 'output'

const input = ref('')
const output = ref('')
const error = ref('')
const indentSize = ref(2)
const inputWordWrap = ref(true)
const outputWordWrap = ref(true)

const searchVisible = ref(false)
const searchQuery = ref('')
const replaceQuery = ref('')
const replaceExpanded = ref(false)
const caseSensitive = ref(false)
const wholeWord = ref(false)
const useRegex = ref(false)
const activePanel = ref<Panel>('input')
const matchIndex = ref(0)

const inputEditorRef = ref<InstanceType<typeof XmlEditorPanel> | null>(null)
const outputEditorRef = ref<InstanceType<typeof XmlEditorPanel> | null>(null)

const matches = ref<TextMatch[]>([])

const searchOptions = computed<SearchOptions>(() => ({
  caseSensitive: caseSensitive.value,
  wholeWord: wholeWord.value,
  useRegex: useRegex.value
}))

const matchCount = computed(() => matches.value.length)
const matchPositionText = computed(() => {
  if (!searchQuery.value) return ''
  if (!matchCount.value) return '无结果'
  return `${matchIndex.value + 1} / ${matchCount.value}`
})

const getEditor = (panel: Panel) => (panel === 'input' ? inputEditorRef.value : outputEditorRef.value)

const getTextarea = (panel: Panel) => getEditor(panel)?.getTextarea() ?? null

const getText = (panel: Panel) => (panel === 'input' ? input.value : output.value)

const setText = (panel: Panel, text: string) => {
  if (panel === 'input') {
    input.value = text
    return
  }
  output.value = text
}

const refreshMatches = () => {
  matches.value = collectMatches(getText(activePanel.value), searchQuery.value, searchOptions.value)
  if (matchIndex.value >= matches.value.length) {
    matchIndex.value = 0
  }
}

const isCurrentMatchSelected = () => {
  const textarea = getTextarea(activePanel.value)
  const match = matches.value[matchIndex.value]
  if (!textarea || !match) return false
  return textarea.selectionStart === match.start && textarea.selectionEnd === match.end
}

const goToMatch = async (index: number) => {
  refreshMatches()
  if (!matches.value.length) return

  const normalized = ((index % matches.value.length) + matches.value.length) % matches.value.length
  matchIndex.value = normalized
  await getEditor(activePanel.value)?.scrollToCurrentMatch()
}

const findNext = () => {
  refreshMatches()
  if (!matches.value.length) return
  if (!isCurrentMatchSelected()) {
    goToMatch(0)
    return
  }
  goToMatch(matchIndex.value + 1)
}

const findPrevious = () => {
  refreshMatches()
  if (!matches.value.length) return
  if (!isCurrentMatchSelected()) {
    goToMatch(matches.value.length - 1)
    return
  }
  goToMatch(matchIndex.value - 1)
}

const openSearch = (panel: Panel) => {
  activePanel.value = panel
  const textarea = getTextarea(panel)

  if (textarea) {
    const { selectionStart, selectionEnd } = textarea
    if (selectionStart !== selectionEnd) {
      searchQuery.value = textarea.value.substring(selectionStart, selectionEnd)
    }
  }

  searchVisible.value = true
  matchIndex.value = 0

  nextTick(() => {
    getEditor(panel)?.focusFind()
    if (searchQuery.value) {
      goToMatch(0)
    } else {
      refreshMatches()
    }
  })
}

const closeSearch = () => {
  searchVisible.value = false
  nextTick(() => {
    getTextarea(activePanel.value)?.focus()
  })
}

const toggleActiveWordWrap = () => {
  if (activePanel.value === 'input') {
    inputWordWrap.value = !inputWordWrap.value
    return
  }
  outputWordWrap.value = !outputWordWrap.value
}

const replaceCurrent = () => {
  const panel = activePanel.value
  const textarea = getTextarea(panel)
  if (!textarea || !searchQuery.value) return

  refreshMatches()
  const match = matches.value[matchIndex.value]
  const { selectionStart, selectionEnd } = textarea

  if (match && selectionStart === match.start && selectionEnd === match.end) {
    const text = getText(panel)
    const newText = text.substring(0, match.start) + replaceQuery.value + text.substring(match.end)
    setText(panel, newText)

    const offset = replaceQuery.value.length
    refreshMatches()

    if (matches.value.length) {
      const nextIndex = matches.value.findIndex((item) => item.start >= match.start + offset)
      goToMatch(nextIndex >= 0 ? nextIndex : 0)
      return
    }

    matchIndex.value = 0
    return
  }

  findNext()
}

const replaceAll = () => {
  if (!searchQuery.value) return
  const panel = activePanel.value
  setText(panel, replaceAllText(getText(panel), searchQuery.value, replaceQuery.value, searchOptions.value))
  matches.value = []
  matchIndex.value = 0
}

const handleGlobalKeydown = (event: KeyboardEvent) => {
  const key = event.key.toLowerCase()
  const target = event.target as HTMLElement | null
  const inputTextarea = getTextarea('input')
  const outputTextarea = getTextarea('output')

  if ((event.ctrlKey || event.metaKey) && key === 'f') {
    if (target === inputTextarea) {
      event.preventDefault()
      openSearch('input')
      return
    }
    if (target === outputTextarea) {
      event.preventDefault()
      openSearch('output')
      return
    }
  }

  if (event.key === 'Escape' && searchVisible.value) {
    event.preventDefault()
    closeSearch()
    return
  }

  if (event.altKey && key === 'z') {
    if (target === inputTextarea || target === outputTextarea || searchVisible.value) {
      event.preventDefault()
      toggleActiveWordWrap()
    }
  }
}

const handleFindKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Enter') return
  event.preventDefault()
  if (event.shiftKey) {
    findPrevious()
  } else {
    findNext()
  }
}

const runFormat = () => {
  error.value = ''
  try {
    output.value = formatXml(input.value, ' '.repeat(Math.max(0, Number(indentSize.value) || 2)))
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'XML 格式化失败'
    output.value = ''
  }
}

const runCompress = () => {
  error.value = ''
  try {
    output.value = compressXml(input.value)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'XML 压缩失败'
    output.value = ''
  }
}

const copyOutput = () => {
  if (!output.value) return
  window.ztools.copyText(output.value)
  window.ztools.showNotification('已复制到剪贴板')
}

const clearAll = () => {
  input.value = ''
  output.value = ''
  error.value = ''
}

watch(
  () => props.enterAction,
  (enterAction: any) => {
    if (enterAction?.type === 'over' && typeof enterAction.payload === 'string') {
      input.value = enterAction.payload
      runFormat()
    }
  },
  { immediate: true }
)

watch(
  [searchQuery, activePanel, input, output, caseSensitive, wholeWord, useRegex],
  () => {
    if (!searchVisible.value) return
    refreshMatches()
  }
)

watch([searchQuery, caseSensitive, wholeWord, useRegex, activePanel, matchIndex], async () => {
  if (!searchVisible.value || !matches.value.length) return
  await getEditor(activePanel.value)?.scrollToCurrentMatch()
})

onMounted(() => {
  document.addEventListener('keydown', handleGlobalKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown)
})
</script>

<template>
  <div class="xml-tool">
    <div class="xml-tool__header">
      <h1>XML 工具</h1>

      <div class="xml-tool__toolbar">
        <label class="xml-tool__indent">
          <span>缩进空格</span>
          <input v-model.number="indentSize" type="number" min="0" max="8" />
        </label>
        <div class="xml-tool__actions">
          <button @click="runFormat">格式化</button>
          <button @click="runCompress">压缩</button>
          <button :disabled="!output" @click="copyOutput">复制结果</button>
          <button @click="clearAll">清空</button>
        </div>
      </div>
    </div>

    <div v-if="error" class="xml-tool__error">{{ error }}</div>

    <div class="xml-tool__panels">
      <div class="xml-tool__field">
        <div class="xml-tool__field-header">
          <span>输入 XML</span>
          <label class="xml-tool__wrap" title="Alt+Z 切换">
            <input v-model="inputWordWrap" type="checkbox" />
            <span>自动换行</span>
          </label>
        </div>
        <XmlEditorPanel
          ref="inputEditorRef"
          v-model="input"
          :word-wrap="inputWordWrap"
          placeholder="粘贴 XML 内容..."
          :show-find="searchVisible && activePanel === 'input'"
          v-model:search-query="searchQuery"
          v-model:replace-query="replaceQuery"
          v-model:case-sensitive="caseSensitive"
          v-model:whole-word="wholeWord"
          v-model:use-regex="useRegex"
          v-model:replace-expanded="replaceExpanded"
          :status-text="matchPositionText"
          :matches="matches"
          :match-index="matchIndex"
          @focus="activePanel = 'input'"
          @find-previous="findPrevious"
          @find-next="findNext"
          @replace="replaceCurrent"
          @replace-all="replaceAll"
          @close-find="closeSearch"
          @search-keydown="handleFindKeydown"
        />
      </div>

      <div class="xml-tool__field">
        <div class="xml-tool__field-header">
          <span>输出结果</span>
          <label class="xml-tool__wrap" title="Alt+Z 切换">
            <input v-model="outputWordWrap" type="checkbox" />
            <span>自动换行</span>
          </label>
        </div>
        <XmlEditorPanel
          ref="outputEditorRef"
          v-model="output"
          :word-wrap="outputWordWrap"
          placeholder="格式化或压缩后的结果将显示在这里..."
          :show-find="searchVisible && activePanel === 'output'"
          v-model:search-query="searchQuery"
          v-model:replace-query="replaceQuery"
          v-model:case-sensitive="caseSensitive"
          v-model:whole-word="wholeWord"
          v-model:use-regex="useRegex"
          v-model:replace-expanded="replaceExpanded"
          :status-text="matchPositionText"
          :matches="matches"
          :match-index="matchIndex"
          @focus="activePanel = 'output'"
          @find-previous="findPrevious"
          @find-next="findNext"
          @replace="replaceCurrent"
          @replace-all="replaceAll"
          @close-find="closeSearch"
          @search-keydown="handleFindKeydown"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.xml-tool {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 20px;
  box-sizing: border-box;
  overflow: hidden;
}

.xml-tool__header {
  flex-shrink: 0;
}

.xml-tool h1 {
  margin: 0 0 12px;
  font-size: 18px;
  font-weight: bold;
}

.xml-tool__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.xml-tool__indent {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
}

.xml-tool__indent input {
  width: 72px;
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  background: #fff;
  color: inherit;
}

.xml-tool__wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: normal;
  cursor: pointer;
}

.xml-tool__wrap input[type='checkbox'] {
  width: 14px;
  height: 14px;
  cursor: pointer;
  margin: 0;
}

.xml-tool__field-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.xml-tool__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.xml-tool__actions button {
  padding: 0 16px;
  border-radius: 4px;
}

.xml-tool__error {
  flex-shrink: 0;
  margin-bottom: 12px;
  color: #e74c3c;
  font-size: 13px;
  white-space: pre-wrap;
}

.xml-tool__panels {
  display: flex;
  flex: 1;
  gap: 16px;
  min-height: 0;
}

.xml-tool__field {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  min-height: 0;
  font-size: 13px;
}

@media (prefers-color-scheme: dark) {
  .xml-tool__indent input {
    background: #424242;
    border-color: #555;
  }
}

@media (max-width: 768px) {
  .xml-tool__panels {
    flex-direction: column;
  }
}
</style>
