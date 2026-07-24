<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Check, ChevronDown, ChevronUp, Clock3, Copy, Database, Download, Search, X } from 'lucide-vue-next'
import BodyRenderer from './renderers/BodyRenderer.vue'
import CodeBlock from './renderers/CodeBlock.vue'
import type { ResponseState } from '../utils/curl/types'
import { countMatches, detectContentKind, formatBytes, formatDuration, guessFileName, prettyJson } from '../utils/content'

const props = defineProps<{
  response: ResponseState | null
  error: string
}>()

const activeTab = ref<'Body' | 'Headers' | 'Raw'>('Body')
const searchOpen = ref(false)
const searchText = ref('')
const activeMatch = ref(0)
const copied = ref(false)
const formattedXml = ref('')

const responseKind = computed(() =>
  props.response ? detectContentKind(props.response.contentType, props.response.body, props.response.bodyBase64) : 'text'
)

const searchableText = computed(() => {
  if (!props.response) return ''
  if (activeTab.value === 'Headers') return props.response.headers.map((item) => `${item.key}: ${item.value}`).join('\n')
  if (activeTab.value === 'Raw') return props.response.body || props.response.bodyBase64 || ''
  if (responseKind.value === 'json') return prettyJson(props.response.body)
  if (responseKind.value === 'xml') return formattedXml.value || props.response.body
  return props.response.body || props.response.bodyBase64 || ''
})

const matchCount = computed(() => countMatches(searchableText.value, searchText.value))
const canCopyPretty = computed(() => activeTab.value === 'Body' && ['json', 'xml', 'html'].includes(responseKind.value))

watch([searchText, activeMatch, activeTab], () => nextTick(scrollToActiveMatch))
watch(() => props.response, () => {
  activeTab.value = 'Body'
  activeMatch.value = 0
  updateFormattedXml()
})

function onKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    searchOpen.value = true
    nextTick(() => document.querySelector<HTMLInputElement>('.search-box input')?.focus())
  }
}

function nextMatch(step: number) {
  if (!matchCount.value) return
  activeMatch.value = (activeMatch.value + step + matchCount.value) % matchCount.value
}

function scrollToActiveMatch() {
  document.querySelector('.response-content .search-hit.active')?.scrollIntoView({ block: 'center', inline: 'nearest' })
}

function downloadResponse() {
  if (!props.response) return
  const services = (window as any).services
  const fileName = guessFileName(props.response.contentType)
  if (props.response.bodyBase64 && services?.writeBinaryFile) {
    services.writeBinaryFile({ fileName, base64: props.response.bodyBase64 })
    return
  }
  const blob = new Blob([props.response.body || ''], { type: props.response.contentType || 'text/plain' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

async function copyPrettyContent() {
  if (!props.response) return
  const text = searchableText.value
  try {
    await navigator.clipboard?.writeText(text)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }
  copied.value = true
  window.setTimeout(() => {
    copied.value = false
  }, 1200)
}

async function updateFormattedXml() {
  if (!props.response || responseKind.value !== 'xml') {
    formattedXml.value = ''
    return
  }
  try {
    const { default: formatXml } = await import('xml-formatter')
    formattedXml.value = formatXml(props.response.body, { indentation: '  ' })
  } catch {
    formattedXml.value = props.response.body
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  updateFormattedXml()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <section class="response-pane">
    <div class="response-head">
      <div class="response-tabs">
        <button :class="{ active: activeTab === 'Body' }" @click="activeTab = 'Body'">Body</button>
        <button :class="{ active: activeTab === 'Headers' }" @click="activeTab = 'Headers'">Headers</button>
        <button :class="{ active: activeTab === 'Raw' }" @click="activeTab = 'Raw'">Raw</button>
      </div>
      <div v-if="response" class="meta">
        <span class="status-pill" :class="{ ok: response.status < 400, fail: response.status >= 400 }">
          <span class="status-code">{{ response.status }}</span>
          <span class="status-text">{{ response.statusText || (response.status < 400 ? 'OK' : 'ERROR') }}</span>
        </span>
        <span class="metric-pill" title="响应时间">
          <Clock3 :size="13" :stroke-width="1.9" />
          {{ formatDuration(response.duration) }}
        </span>
        <span class="metric-pill" title="响应大小">
          <Database :size="13" :stroke-width="1.9" />
          {{ formatBytes(response.size) }}
        </span>
        <button v-if="canCopyPretty" class="download-button" :title="copied ? '已复制' : '复制内容'" @click="copyPrettyContent">
          <Check v-if="copied" :size="15" :stroke-width="1.9" />
          <Copy v-else :size="15" :stroke-width="1.8" />
        </button>
        <button class="download-button" title="下载响应" @click="downloadResponse">
          <Download :size="15" :stroke-width="1.8" />
        </button>
      </div>
    </div>

    <div v-if="searchOpen" class="search-box">
      <Search :size="14" :stroke-width="1.8" />
      <input v-model="searchText" placeholder="搜索响应内容" />
      <span>{{ matchCount ? activeMatch + 1 : 0 }}/{{ matchCount }}</span>
      <button @click="nextMatch(-1)"><ChevronUp :size="14" /></button>
      <button @click="nextMatch(1)"><ChevronDown :size="14" /></button>
      <button @click="searchOpen = false"><X :size="14" /></button>
    </div>

    <div class="response-content">
      <div v-if="error" class="empty-state error">{{ error }}</div>
      <div v-else-if="!response" class="empty-state">发送请求后，响应内容会显示在这里。</div>
      <BodyRenderer
        v-else-if="activeTab === 'Body'"
        :content="response.body"
        :content-type="response.contentType"
        :body-base64="response.bodyBase64"
        :size="response.size"
        kind="auto"
        :query="searchText"
        :active-index="activeMatch"
        @download="downloadResponse"
      />
      <CodeBlock
        v-else
        :content="searchableText"
        :kind="activeTab === 'Headers' ? 'plain' : responseKind"
        :query="searchText"
        :active-index="activeMatch"
      />
    </div>
  </section>
</template>

<style scoped>
.response-pane {
  position: relative;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  padding: 10px 14px 14px;
  background: #f8fafc;
}

.response-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 34px;
}

.response-tabs {
  display: flex;
  gap: 3px;
}

.response-tabs button,
.download-button,
.search-box button {
  display: inline-grid;
  place-items: center;
  height: 28px;
  border: 0;
  border-radius: 6px;
  color: #64748b;
  background: transparent;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.response-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 10px;
  font-weight: 700;
}

.response-tabs button.active,
.response-tabs button:hover {
  color: #4f46e5;
  background: #f5f3ff;
}

.download-button:hover,
.search-box button:hover {
  color: #4f46e5;
  background: #eef2ff;
}

.meta {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #475569;
  font-size: 12px;
  font-weight: 800;
}

.status-pill,
.metric-pill {
  display: inline-grid;
  grid-auto-flow: column;
  gap: 6px;
  align-items: center;
  height: 26px;
  padding: 0 9px;
  border: 0;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px rgb(15 23 42 / 6%);
}

.status-pill.ok {
  color: #00875a;
  background: linear-gradient(180deg, #ecfdf5 0%, #f0fdf4 100%);
}

.status-pill.fail {
  color: #dc2626;
  background: linear-gradient(180deg, #fff1f2 0%, #fef2f2 100%);
}

.status-code {
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0;
}

.status-text {
  opacity: 0.78;
}

.metric-pill {
  color: #526174;
  background: #fff;
}

.metric-pill svg {
  color: #94a3b8;
}

.response-content {
  display: grid;
  position: relative;
  min-height: 0;
  overflow: hidden;
  padding: 10px 0 0;
}

.empty-state {
  display: grid;
  place-items: center;
  min-height: 100%;
  box-sizing: border-box;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  color: #94a3b8;
  background: #fff;
  font-size: 12px;
}

.empty-state.error {
  color: #64748b;
}

.search-box {
  position: absolute;
  top: 52px;
  right: 12px;
  z-index: 20;
  display: grid;
  grid-template-columns: auto 150px auto auto auto auto;
  gap: 4px;
  align-items: center;
  height: 30px;
  padding: 0 5px 0 8px;
  border: 1px solid #dbe2ea;
  border-radius: 7px;
  color: #64748b;
  background: #fff;
  box-shadow: 0 10px 28px rgb(15 23 42 / 12%);
}

.search-box input {
  width: 150px;
  border: 0;
  outline: none;
}
</style>
