<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import HistorySidebar from '../components/HistorySidebar.vue'
import RequestEditor from '../components/RequestEditor.vue'
import ResponseViewer from '../components/ResponseViewer.vue'
import { createEmptyRequest, createEntry, normalizeUrl, parseCurlCommand } from '../utils/curl/parser'
import type { HistoryItem, ParsedCurlRequest, RequestEntry, ResponseState } from '../utils/curl/types'
import { loadHistory, makeHistoryItem, saveHistory } from '../utils/history'
import { sendHttpRequest } from '../utils/http'

const props = defineProps<{
  enterAction: Record<string, any>
}>()

const request = ref<ParsedCurlRequest>(createEmptyRequest())
const response = ref<ResponseState | null>(null)
const responseError = ref('')
const history = ref<HistoryItem[]>([])
const activeHistoryId = ref('')
const historyCollapsed = ref(true)
const sending = ref(false)
const splitPercent = ref(48)
const formEntries = ref<RequestEntry[]>([createEntry()])
const binaryFile = ref<File | null>(null)

const gridStyle = computed(() => ({
  gridTemplateRows: `minmax(190px, ${splitPercent.value}%) 8px minmax(180px, 1fr)`
}))

onMounted(() => {
  history.value = loadHistory()
})

watch(
  () => props.enterAction,
  async (action) => {
    const text = extractCurlText(action)
    if (text) {
      importCurl(text)
      return
    }
    if (isCurlEntryAction(action)) await importFromClipboard()
  },
  { deep: true }
)

function extractCurlText(action: Record<string, any>) {
  if (!action) return ''
  const seen = new Set<any>()
  const visit = (value: any): string => {
    if (!value || seen.has(value)) return ''
    if (typeof value === 'string') {
      const text = value.trim()
      return /^curl(?:\.exe)?\s+/i.test(text) ? text : ''
    }
    if (typeof value !== 'object') return ''
    seen.add(value)

    const directKeys = ['payload', 'text', 'content', 'data', 'keyword', 'value', 'body']
    for (const key of directKeys) {
      const text = visit(value[key])
      if (text) return text
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const text = visit(item)
        if (text) return text
      }
    }
    return ''
  }
  return visit(action)
}

function isCurlEntryAction(action: Record<string, any>) {
  if (!action) return false
  return ['curl', 'curl-tool'].includes(String(action.code || '').toLowerCase())
}

async function importFromClipboard() {
  try {
    const ztools = (window as any).ztools
    const clipboardText =
      (await ztools?.getClipboardContent?.()) ||
      (await ztools?.readText?.()) ||
      (navigator.clipboard ? await navigator.clipboard.readText() : '')
    if (clipboardText) importCurl(clipboardText)
  } catch {
    responseError.value = ''
  }
}

function importCurl(text: string) {
  const result = parseCurlCommand(text)
  if (!result.ok || !result.request) {
    responseError.value = result.error || ''
    return
  }
  request.value = ensureRows(result.request)
  response.value = null
  responseError.value = ''
  activeHistoryId.value = ''
}

function newRequest() {
  request.value = createEmptyRequest()
  response.value = null
  responseError.value = ''
  activeHistoryId.value = ''
}

function selectHistory(item: HistoryItem) {
  const result = parseCurlCommand(item.command || `curl -X ${item.method} ${item.url}`)
  if (result.ok && result.request) {
    request.value = ensureRows(result.request)
    response.value = null
    responseError.value = ''
    activeHistoryId.value = item.id
  }
}

function deleteHistory(item: HistoryItem) {
  history.value = history.value.filter((entry) => entry.id !== item.id)
  if (activeHistoryId.value === item.id) activeHistoryId.value = ''
  saveHistory(history.value)
}

async function send() {
  if (!request.value.baseUrl.trim()) return
  sending.value = true
  responseError.value = ''
  try {
    request.value.baseUrl = normalizeUrl(request.value.baseUrl)
    response.value = await sendHttpRequest({
      request: request.value,
      bodyType: request.value.bodyType,
      formEntries: formEntries.value,
      binaryFile: binaryFile.value
    })
    saveCurrentToHistory()
  } catch (error: any) {
    response.value = null
    responseError.value = error?.message || '请求失败'
  } finally {
    sending.value = false
  }
}

function saveCurrentToHistory() {
  const item = makeHistoryItem({ ...request.value, rawCommand: buildCurlCommand(request.value) })
  history.value = [item, ...history.value].sort((a, b) => b.createdAt - a.createdAt).slice(0, 200)
  activeHistoryId.value = item.id
  saveHistory(history.value)
}

function buildCurlCommand(current: ParsedCurlRequest) {
  const parts = ['curl', '-X', current.method, quote(normalizeUrl(current.baseUrl || current.url))]
  current.headers.filter((item) => item.enabled && item.key).forEach((item) => parts.push('-H', quote(`${item.key}: ${item.value}`)))
  current.cookies.filter((item) => item.enabled && item.key).forEach((item) => parts.push('-H', quote(`Cookie: ${item.key}=${item.value}`)))
  if (current.bodyType !== 'none' && current.body) parts.push('-d', quote(current.body))
  return parts.join(' ')
}

function quote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function ensureRows(next: ParsedCurlRequest): ParsedCurlRequest {
  return {
    ...next,
    queryParams: next.queryParams.length ? next.queryParams : [createEntry()],
    headers: next.headers.length ? next.headers : [createEntry()],
    cookies: next.cookies.length ? next.cookies : [createEntry()]
  }
}

function startResize(event: PointerEvent) {
  const container = (event.currentTarget as HTMLElement).parentElement
  if (!container) return
  const rect = container.getBoundingClientRect()
  const onMove = (moveEvent: PointerEvent) => {
    const next = ((moveEvent.clientY - rect.top) / rect.height) * 100
    splitPercent.value = Math.max(28, Math.min(72, next))
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}
</script>

<template>
  <main class="curl-tool">
    <HistorySidebar
      :history="history"
      :active-id="activeHistoryId"
      :collapsed="historyCollapsed"
      @new="newRequest"
      @import="importFromClipboard"
      @toggle="historyCollapsed = !historyCollapsed"
      @select="selectHistory"
      @delete="deleteHistory"
    />

    <section class="workspace" :style="gridStyle">
      <RequestEditor
        :request="request"
        :sending="sending"
        @send="send"
        @form-change="formEntries = $event"
        @binary-change="binaryFile = $event"
      />
      <div class="splitter" @pointerdown="startResize"></div>
      <ResponseViewer :response="response" :error="responseError" />
    </section>
  </main>
</template>

<style scoped>
.curl-tool {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  color: #0f172a;
  background: #f8fafc;
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
}

.workspace {
  display: grid;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.splitter {
  height: 8px;
  background: linear-gradient(#eef2f7, #e5e7eb);
  cursor: row-resize;
}

.splitter:hover {
  background: #c7d2fe;
}
</style>
