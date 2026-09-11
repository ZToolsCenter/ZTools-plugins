<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { gitmojis, type GitmojiItem } from './gitmojis'

defineProps({
  enterAction: {
    type: Object,
    required: true
  }
})

interface HistoryItem {
  id: string
  message: string
  gitmojiCode: string
  commitType: string
  summary: string
  createdAt: string
}

const HISTORY_STORAGE_KEY = 'git-commit-message:history'
const MAX_HISTORY_ITEMS = 20

const selectedType = ref<GitmojiItem>(gitmojis[0])
const gitmojiQuery = ref('')
const scope = ref('')
const summary = ref('')
const body = ref('')
const issue = ref('')
const copyStatus = ref<'idle' | 'success' | 'error'>('idle')
const historyItems = ref<HistoryItem[]>([])
let statusTimer: number | undefined

const normalizedSummary = computed(() => summary.value.trim())
const canGenerate = computed(() => normalizedSummary.value.length > 0)
const normalizedGitmojiQuery = computed(() => gitmojiQuery.value.trim().toLowerCase())

const visibleGitmojis = computed(() => {
  const query = normalizedGitmojiQuery.value

  if (!query) {
    return gitmojis.filter((item) => item.featured)
  }

  return gitmojis.filter((item) => {
    const searchableText = [
      item.label,
      item.emoji,
      item.code,
      item.code.replace(/:/g, ''),
      item.commitType,
      item.description,
      ...item.keywords
    ]
      .join(' ')
      .toLowerCase()

    return searchableText.includes(query)
  })
})

const gitmojiSectionTitle = computed(() =>
  normalizedGitmojiQuery.value ? `搜索结果 (${visibleGitmojis.value.length})` : '常用推荐'
)

const generatedMessage = computed(() => {
  const selected = selectedType.value
  const normalizedScope = scope.value.trim()
  const scopeText = normalizedScope ? `(${normalizedScope})` : ''
  const header = `${selected.emoji} ${selected.commitType}${scopeText}: ${normalizedSummary.value}`
  const segments = [header]
  const normalizedBody = body.value.trim()
  const normalizedIssue = issue.value.trim()

  if (normalizedBody) {
    segments.push(normalizedBody)
  }

  if (normalizedIssue) {
    segments.push(`Refs ${normalizedIssue}`)
  }

  return segments.join('\n\n')
})

const resetStatusLater = () => {
  if (statusTimer) {
    window.clearTimeout(statusTimer)
  }
  statusTimer = window.setTimeout(() => {
    copyStatus.value = 'idle'
  }, 1800)
}

const copyWithBrowserApi = async (text: string) => {
  if (!navigator.clipboard?.writeText) {
    return false
  }

  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (err) {
    return false
  }
}

const copyWithPreload = (text: string) => {
  try {
    return window.services?.copyText?.(text) === true
  } catch (err) {
    return false
  }
}

const copyMessage = async (text: string) => (await copyWithBrowserApi(text)) || copyWithPreload(text)

const showCopyStatus = (copied: boolean) => {
  copyStatus.value = copied ? 'success' : 'error'
  resetStatusLater()
}

const isHistoryItem = (item: unknown): item is HistoryItem => {
  if (!item || typeof item !== 'object') return false

  const value = item as Record<string, unknown>
  return (
    typeof value.id === 'string' &&
    typeof value.message === 'string' &&
    typeof value.gitmojiCode === 'string' &&
    typeof value.commitType === 'string' &&
    typeof value.summary === 'string' &&
    typeof value.createdAt === 'string'
  )
}

const saveHistoryItems = (items: HistoryItem[]) => {
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(items))
  } catch (err) {
    // localStorage may be unavailable in a restricted WebView.
  }
}

const clearPersistedHistory = () => {
  try {
    window.localStorage.removeItem(HISTORY_STORAGE_KEY)
  } catch (err) {
    // localStorage may be unavailable in a restricted WebView.
  }
}

const loadHistoryItems = () => {
  try {
    const rawHistory = window.localStorage.getItem(HISTORY_STORAGE_KEY)
    if (!rawHistory) return

    const parsedHistory = JSON.parse(rawHistory)
    if (!Array.isArray(parsedHistory)) {
      historyItems.value = []
      saveHistoryItems([])
      return
    }

    historyItems.value = parsedHistory.filter(isHistoryItem).slice(0, MAX_HISTORY_ITEMS)
    saveHistoryItems(historyItems.value)
  } catch (err) {
    historyItems.value = []
    saveHistoryItems([])
  }
}

const createHistoryItem = (message: string): HistoryItem => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  message,
  gitmojiCode: selectedType.value.code,
  commitType: selectedType.value.commitType,
  summary: normalizedSummary.value,
  createdAt: new Date().toISOString()
})

const addHistoryItem = (message: string) => {
  const latestItem = historyItems.value[0]
  let nextItems: HistoryItem[]

  if (latestItem?.message === message) {
    nextItems = [{ ...latestItem, createdAt: new Date().toISOString() }, ...historyItems.value.slice(1)]
  } else {
    nextItems = [createHistoryItem(message), ...historyItems.value]
  }

  historyItems.value = nextItems.slice(0, MAX_HISTORY_ITEMS)
  saveHistoryItems(historyItems.value)
}

const handleGenerate = async () => {
  if (!canGenerate.value) return

  const message = generatedMessage.value
  const copied = await copyMessage(message)
  showCopyStatus(copied)

  if (copied) {
    addHistoryItem(message)
  }
}

const handleSelectGitmoji = (gitmoji: GitmojiItem) => {
  selectedType.value = gitmoji
}

const handleCopyHistory = async (historyItem: HistoryItem) => {
  showCopyStatus(await copyMessage(historyItem.message))
}

const handleClearHistory = () => {
  historyItems.value = []
  clearPersistedHistory()
}

const getHistoryTitle = (message: string) => message.split('\n')[0] || message

const formatHistoryTime = (createdAt: string) => {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return ''

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

const handleKeydown = (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    handleGenerate()
  }
}

onMounted(() => {
  loadHistoryItems()
})

onBeforeUnmount(() => {
  if (statusTimer) {
    window.clearTimeout(statusTimer)
  }
})
</script>

<template>
  <main class="commit-tool" @keydown="handleKeydown">
    <section class="commit-panel">
      <header class="commit-header">
        <div>
          <h1>Git Commit Message</h1>
          <p>生成带 Gitmoji 的 Conventional Commit 提交信息</p>
        </div>
      </header>

      <div class="form-grid">
        <label class="field summary-field">
          <span class="field-label required">提交摘要</span>
          <input v-model="summary" type="text" placeholder="请输入提交摘要" autofocus />
        </label>

        <label class="field scope-field">
          <span class="field-label">影响范围</span>
          <input v-model="scope" type="text" placeholder="auth / ui / api" />
        </label>
      </div>

      <div class="field-group">
        <label class="field-label" for="gitmoji-search">提交类型</label>
        <input
          id="gitmoji-search"
          v-model="gitmojiQuery"
          class="gitmoji-search"
          type="search"
          placeholder="搜索 Gitmoji"
        />
        <div class="type-toolbar">
          <span>{{ gitmojiSectionTitle }}</span>
          <button
            v-if="gitmojiQuery"
            class="clear-search"
            type="button"
            @click="gitmojiQuery = ''"
          >
            清空
          </button>
        </div>
        <div class="type-grid" :class="{ searching: !!normalizedGitmojiQuery }">
          <button
            v-for="typeItem in visibleGitmojis"
            :key="typeItem.code"
            class="type-button"
            :class="{ active: selectedType.code === typeItem.code }"
            type="button"
            @click="handleSelectGitmoji(typeItem)"
          >
            <span class="type-emoji">{{ typeItem.emoji }}</span>
            <span class="type-meta">
              <span>{{ typeItem.label }}</span>
              <span>{{ typeItem.commitType }}</span>
            </span>
          </button>
          <div v-if="visibleGitmojis.length === 0" class="empty-result">
            没有找到匹配的 Gitmoji
          </div>
        </div>
        <div class="selected-hint">
          <span>{{ selectedType.emoji }}</span>
          <strong>{{ selectedType.label }}</strong>
          <code>{{ selectedType.code }}</code>
          <span>{{ selectedType.description }}</span>
        </div>
      </div>

      <label class="field">
        <span class="field-label">详细说明</span>
        <textarea v-model="body" rows="4" placeholder="可选：补充说明这次提交的背景或影响"></textarea>
      </label>

      <label class="field issue-field">
        <span class="field-label">关联 issue</span>
        <input v-model="issue" type="text" placeholder="#123" />
      </label>

      <section class="preview-block">
        <div class="preview-header">
          <span class="field-label">预览 · {{ selectedType.code }}</span>
        </div>
        <pre>{{ generatedMessage }}</pre>
      </section>

      <div class="action-bar">
        <div
          v-if="copyStatus !== 'idle'"
          class="copy-toast"
          :class="copyStatus"
          role="status"
        >
          {{ copyStatus === 'success' ? '已复制到剪贴板' : '复制失败，请手动复制' }}
        </div>
        <button class="copy-button" type="button" :disabled="!canGenerate" @click="handleGenerate">
          生成并复制
        </button>
      </div>

      <section class="history-block">
        <div class="history-header">
          <div>
            <h2>历史记录</h2>
            <span>{{ historyItems.length }} / {{ MAX_HISTORY_ITEMS }}</span>
          </div>
          <button
            class="history-clear"
            type="button"
            :disabled="historyItems.length === 0"
            @click="handleClearHistory"
          >
            清空
          </button>
        </div>

        <div v-if="historyItems.length === 0" class="history-empty">暂无历史记录</div>

        <div v-else class="history-list">
          <article v-for="historyItem in historyItems" :key="historyItem.id" class="history-item">
            <div class="history-item-header">
              <div>
                <strong>{{ getHistoryTitle(historyItem.message) }}</strong>
                <span>{{ historyItem.gitmojiCode }} · {{ historyItem.commitType }} · {{ formatHistoryTime(historyItem.createdAt) }}</span>
              </div>
              <button class="history-copy" type="button" @click="handleCopyHistory(historyItem)">
                复制
              </button>
            </div>
            <pre>{{ historyItem.message }}</pre>
          </article>
        </div>
      </section>
    </section>
  </main>
</template>

<style scoped>
.commit-tool {
  height: 100vh;
  overflow: auto;
  padding: 12px;
  box-sizing: border-box;
  color: #1d2430;
  background:
    linear-gradient(135deg, rgba(17, 124, 109, 0.08), transparent 34%),
    linear-gradient(315deg, rgba(196, 70, 46, 0.08), transparent 28%),
    #f7f8fb;
  scrollbar-color: rgba(17, 124, 109, 0.32) transparent;
  scrollbar-width: thin;
}

.commit-panel {
  width: min(720px, 100%);
  margin: 0 auto;
  padding-bottom: 58px;
}

.commit-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 10px;
}

.commit-header h1 {
  margin: 0;
  font-size: 18px;
  line-height: 1.25;
  letter-spacing: 0;
}

.commit-header p {
  margin: 6px 0 0;
  color: #657184;
  font-size: 12px;
}

.field-group,
.field,
.preview-block {
  display: block;
  margin-bottom: 12px;
}

.field-label {
  display: block;
  margin-bottom: 8px;
  color: #526071;
  font-size: 13px;
  font-weight: 600;
}

.required::after {
  content: ' *';
  color: #c4462e;
}

.gitmoji-search {
  margin-bottom: 7px;
}

.type-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 24px;
  margin-bottom: 6px;
  color: #657184;
  font-size: 12px;
  font-weight: 600;
}

.clear-search {
  height: 24px;
  padding: 0 8px;
  border: 1px solid #d8dee8;
  border-radius: 6px;
  background: #fff;
  color: #526071;
  font-size: 12px;
  line-height: 1;
}

.clear-search:hover {
  color: #117c6d;
}

.type-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  max-height: min(146px, 24vh);
  overflow: auto;
  padding-right: 4px;
  scrollbar-color: rgba(17, 124, 109, 0.38) transparent;
  scrollbar-width: thin;
}

.type-grid.searching {
  max-height: min(210px, 34vh);
}

.commit-tool::-webkit-scrollbar,
.history-list::-webkit-scrollbar {
  width: 8px;
}

.commit-tool::-webkit-scrollbar-track,
.history-list::-webkit-scrollbar-track {
  background: transparent;
}

.commit-tool::-webkit-scrollbar-thumb,
.history-list::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background: rgba(17, 124, 109, 0.24);
  background-clip: content-box;
}

.commit-tool:hover::-webkit-scrollbar-thumb,
.history-list:hover::-webkit-scrollbar-thumb {
  background: rgba(17, 124, 109, 0.46);
  background-clip: content-box;
}

.type-grid::-webkit-scrollbar {
  width: 8px;
}

.type-grid::-webkit-scrollbar-track {
  background: transparent;
}

.type-grid::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background: rgba(17, 124, 109, 0.28);
  background-clip: content-box;
}

.type-grid:hover::-webkit-scrollbar-thumb {
  background: rgba(17, 124, 109, 0.5);
  background-clip: content-box;
}

.type-grid::-webkit-scrollbar-thumb:hover {
  background: rgba(17, 124, 109, 0.72);
  background-clip: content-box;
}

.type-button {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  min-height: 38px;
  padding: 6px 8px;
  border: 1px solid #d8dee8;
  border-radius: 8px;
  background: #fff;
  color: #263241;
  font-size: 12px;
  line-height: 1.2;
  text-align: left;
}

.type-button.active {
  border-color: #117c6d;
  background: #eaf6f3;
  color: #0b5f54;
  font-weight: 700;
}

.type-emoji {
  flex: 0 0 21px;
  text-align: center;
  font-size: 15px;
}

.type-meta {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.type-meta span:first-child {
  overflow: hidden;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.type-meta span:last-child {
  color: #7a8494;
  font-size: 10px;
}

.empty-result {
  grid-column: 1 / -1;
  padding: 22px 12px;
  border: 1px dashed #d8dee8;
  border-radius: 8px;
  color: #7a8494;
  text-align: center;
}

.selected-hint {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 30px;
  margin-top: 8px;
  padding: 6px 9px;
  box-sizing: border-box;
  border: 1px solid #d8dee8;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.72);
  color: #526071;
  font-size: 12px;
}

.selected-hint code {
  color: #0b5f54;
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 12px;
}

.form-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 170px;
  gap: 12px;
}

input,
textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #d8dee8;
  border-radius: 8px;
  background: #fff;
  color: #1d2430;
  font: inherit;
  outline: none;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}

input[type='search']::-webkit-search-cancel-button {
  display: none;
}

input {
  height: 40px;
  padding: 0 11px;
}

.summary-field input {
  height: 44px;
  font-size: 15px;
  font-weight: 600;
}

.summary-field input::placeholder {
  font-weight: 500;
}

.scope-field input {
  height: 38px;
  font-size: 13px;
}

.gitmoji-search {
  height: 34px;
  border-color: #dfe4ec;
  font-size: 12px;
  box-shadow: none;
}

.gitmoji-search:focus {
  border-color: #63b7aa;
  box-shadow: 0 0 0 2px rgba(17, 124, 109, 0.08);
}

textarea {
  resize: vertical;
  min-height: 76px;
  padding: 10px 11px;
  line-height: 1.55;
}

input:focus,
textarea:focus {
  border-color: #117c6d;
  box-shadow: 0 0 0 3px rgba(17, 124, 109, 0.12);
}

.issue-field {
  max-width: 220px;
}

.preview-block {
  padding-top: 4px;
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 26px;
  gap: 12px;
}

pre {
  min-height: 58px;
  max-height: 120px;
  margin: 0;
  padding: 13px;
  overflow: auto;
  border: 1px solid #d8dee8;
  border-radius: 8px;
  background: #fff;
  color: #1d2430;
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.action-bar {
  position: sticky;
  z-index: 5;
  bottom: 0;
  margin: 0 -2px 12px;
  padding: 8px 2px 4px;
  background: linear-gradient(180deg, rgba(247, 248, 251, 0), #f7f8fb 34%);
}

.copy-toast {
  width: fit-content;
  max-width: 100%;
  margin: 0 auto 7px;
  padding: 7px 12px;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: 999px;
  box-shadow: 0 8px 18px rgba(29, 36, 48, 0.12);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.copy-toast.success {
  border-color: rgba(17, 124, 109, 0.24);
  background: #e8f6f2;
  color: #0b5f54;
}

.copy-toast.error {
  border-color: rgba(196, 70, 46, 0.24);
  background: #fff0ec;
  color: #b13e2a;
}

.copy-button {
  width: 100%;
  height: 40px;
  border-radius: 8px;
  background: #117c6d;
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
}

.copy-button:not(:disabled):hover {
  background: #0f6f62;
}

.history-block {
  margin-top: 16px;
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 9px;
}

.history-header h2 {
  margin: 0;
  color: #263241;
  font-size: 15px;
  line-height: 1.3;
  letter-spacing: 0;
}

.history-header span {
  display: block;
  margin-top: 2px;
  color: #7a8494;
  font-size: 12px;
}

.history-clear,
.history-copy {
  border: 1px solid #d8dee8;
  border-radius: 6px;
  background: #fff;
  color: #526071;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
}

.history-clear {
  height: 28px;
  padding: 0 10px;
}

.history-copy {
  flex: 0 0 auto;
  height: 28px;
  padding: 0 9px;
}

.history-clear:not(:disabled):hover,
.history-copy:hover {
  color: #117c6d;
}

.history-empty {
  padding: 20px 12px;
  border: 1px dashed #d8dee8;
  border-radius: 8px;
  color: #7a8494;
  font-size: 13px;
  text-align: center;
}

.history-list {
  display: grid;
  gap: 9px;
  max-height: min(280px, 32vh);
  overflow: auto;
  padding-right: 4px;
  scrollbar-color: rgba(17, 124, 109, 0.38) transparent;
  scrollbar-width: thin;
}

.history-item {
  padding: 11px;
  border: 1px solid #d8dee8;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.72);
}

.history-item-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.history-item-header div {
  min-width: 0;
}

.history-item-header strong {
  display: block;
  overflow: hidden;
  color: #263241;
  font-size: 13px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-item-header span {
  display: block;
  margin-top: 3px;
  color: #7a8494;
  font-size: 11px;
}

.history-item pre {
  min-height: 0;
  max-height: 112px;
  padding: 10px;
  font-size: 12px;
}

@media (max-width: 520px) {
  .commit-tool {
    padding: 10px;
  }

  .commit-header {
    margin-bottom: 8px;
  }

  .commit-header h1 {
    font-size: 16px;
  }

  .commit-header p {
    font-size: 12px;
  }

  .type-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    max-height: min(140px, 24vh);
  }

  .form-grid {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .summary-field input {
    height: 44px;
  }

  .scope-field input,
  .gitmoji-search {
    height: 34px;
  }

  .issue-field {
    max-width: none;
  }

  .history-item-header {
    align-items: stretch;
  }

  .preview-header {
    align-items: flex-start;
    flex-wrap: wrap;
    justify-content: flex-start;
  }
}

@media (max-width: 380px) {
  .commit-tool {
    padding: 10px;
  }

  .type-grid {
    gap: 6px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    max-height: min(122px, 23vh);
  }

  .type-button {
    gap: 5px;
    min-height: 34px;
    padding: 6px 7px;
    font-size: 12px;
  }

  .type-emoji {
    flex-basis: 19px;
    font-size: 15px;
  }

  .type-meta span:last-child {
    display: none;
  }

  .selected-hint {
    gap: 6px;
    padding: 7px 8px;
  }

  .summary-field input {
    height: 42px;
    font-size: 14px;
  }

  .scope-field input,
  .gitmoji-search {
    height: 32px;
  }

  .history-item-header {
    gap: 8px;
  }
}

@media (max-height: 720px) {
  .commit-tool {
    padding-top: 10px;
    padding-bottom: 10px;
  }

  .commit-header {
    margin-bottom: 10px;
  }

  .field-group,
  .field,
  .preview-block {
    margin-bottom: 10px;
  }

  .field-label {
    margin-bottom: 6px;
  }

  .type-grid {
    max-height: min(118px, 22vh);
  }

  .type-grid.searching {
    max-height: min(164px, 30vh);
  }

  textarea {
    min-height: 66px;
  }

  pre {
    min-height: 50px;
    max-height: 100px;
  }

  .copy-button {
    height: 40px;
  }

  .history-block {
    margin-top: 12px;
  }

  .history-list {
    max-height: min(220px, 28vh);
  }
}

@media (max-height: 620px) {
  .commit-header p {
    display: none;
  }

  .commit-header h1 {
    font-size: 16px;
  }

  .type-grid {
    max-height: min(102px, 21vh);
  }

  .type-grid.searching {
    max-height: min(146px, 28vh);
  }

  .selected-hint span:last-child {
    display: none;
  }
}

@media (max-height: 560px) {
  .commit-tool {
    padding-top: 8px;
    padding-bottom: 8px;
  }

  .commit-header p {
    display: none;
  }

  .commit-header h1 {
    font-size: 16px;
  }

  .type-grid {
    max-height: min(88px, 20vh);
  }

  .type-grid.searching {
    max-height: min(130px, 28vh);
  }

  .type-button {
    min-height: 34px;
  }

  .selected-hint {
    min-height: 30px;
    margin-top: 8px;
  }

  textarea {
    min-height: 52px;
  }

  pre {
    min-height: 44px;
    max-height: 76px;
  }

  .history-empty {
    padding: 14px 10px;
  }

  .history-list {
    gap: 7px;
    max-height: min(150px, 24vh);
  }

  .history-item {
    padding: 9px;
  }

  .history-item pre {
    max-height: 72px;
  }
}

@media (prefers-color-scheme: dark) {
  .commit-tool {
    color: #edf1f7;
    background:
      linear-gradient(135deg, rgba(38, 184, 163, 0.11), transparent 34%),
      linear-gradient(315deg, rgba(221, 101, 74, 0.1), transparent 28%),
      #20242b;
    scrollbar-color: rgba(38, 184, 163, 0.4) transparent;
  }

  .commit-header p,
  .field-label {
    color: #a7b0be;
  }

  .type-button,
  input,
  textarea,
  pre,
  .clear-search,
  .history-clear,
  .history-copy {
    border-color: #3a424f;
    background: #292f38;
    color: #edf1f7;
  }

  .type-toolbar,
  .type-meta span:last-child,
  .history-header span,
  .history-item-header span {
    color: #a7b0be;
  }

  .type-grid,
  .history-list {
    scrollbar-color: rgba(38, 184, 163, 0.46) transparent;
  }

  .commit-tool::-webkit-scrollbar-thumb,
  .type-grid::-webkit-scrollbar-thumb,
  .history-list::-webkit-scrollbar-thumb {
    background: rgba(38, 184, 163, 0.3);
    background-clip: content-box;
  }

  .commit-tool:hover::-webkit-scrollbar-thumb,
  .type-grid:hover::-webkit-scrollbar-thumb,
  .history-list:hover::-webkit-scrollbar-thumb {
    background: rgba(38, 184, 163, 0.55);
    background-clip: content-box;
  }

  .type-grid::-webkit-scrollbar-thumb:hover {
    background: rgba(38, 184, 163, 0.78);
    background-clip: content-box;
  }

  .history-header h2,
  .history-item-header strong {
    color: #edf1f7;
  }

  .type-button.active {
    border-color: #26b8a3;
    background: rgba(38, 184, 163, 0.16);
    color: #71e2d1;
  }

  .clear-search:hover {
    color: #71e2d1;
  }

  .empty-result,
  .selected-hint,
  .history-empty,
  .history-item {
    border-color: #3a424f;
    background: rgba(41, 47, 56, 0.7);
    color: #a7b0be;
  }

  .history-clear:not(:disabled):hover,
  .history-copy:hover {
    color: #71e2d1;
  }

  .selected-hint code {
    color: #71e2d1;
  }

  .action-bar {
    background: linear-gradient(180deg, rgba(32, 36, 43, 0), #20242b 34%);
  }

  .copy-toast {
    box-shadow: 0 8px 18px rgba(0, 0, 0, 0.24);
  }

  .copy-toast.success {
    border-color: rgba(38, 184, 163, 0.34);
    background: #183d39;
    color: #91f0df;
  }

  .copy-toast.error {
    border-color: rgba(221, 101, 74, 0.36);
    background: #482b27;
    color: #ffb5a5;
  }

  input:focus,
  textarea:focus {
    border-color: #26b8a3;
    box-shadow: 0 0 0 3px rgba(38, 184, 163, 0.16);
  }

  .copy-button {
    background: #158d7d;
  }

  .copy-button:not(:disabled):hover {
    background: #19a08d;
  }
}
</style>
