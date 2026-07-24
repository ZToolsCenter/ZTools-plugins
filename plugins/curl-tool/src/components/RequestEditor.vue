<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FileUp, WandSparkles, X } from 'lucide-vue-next'
import MethodDropdown from './MethodDropdown.vue'
import KeyValueTable from './KeyValueTable.vue'
import CodeBlock from './renderers/CodeBlock.vue'
import JsonEditableBlock from './renderers/JsonEditableBlock.vue'
import XmlEditableBlock from './renderers/XmlEditableBlock.vue'
import type { ParsedCurlRequest, RequestBodyType, RequestEntry } from '../utils/curl/types'
import { parseKeyValueBody } from '../utils/curl/parser'

const props = defineProps<{
  request: ParsedCurlRequest
  sending: boolean
}>()

const emit = defineEmits<{
  send: []
  change: []
  'binary-change': [file: File | null]
  'form-change': [entries: RequestEntry[]]
}>()

const requestTabs = ['Params', 'Body', 'Headers', 'Cookies', 'Auth'] as const
const bodyTypes: Array<{ value: RequestBodyType; label: string }> = [
  { value: 'none', label: 'none' },
  { value: 'form-data', label: 'form-data' },
  { value: 'x-www-form-urlencoded', label: 'x-www-form-urlencoded' },
  { value: 'json', label: 'JSON' },
  { value: 'xml', label: 'XML' },
  { value: 'text', label: 'Text' },
  { value: 'binary', label: 'Binary' }
]

const activeTab = ref<(typeof requestTabs)[number]>('Params')
const activeBodyType = ref<RequestBodyType>(props.request.bodyType)
const bodyByType = ref<Record<RequestBodyType, string>>({
  none: '',
  'form-data': '',
  'x-www-form-urlencoded': '',
  json: '',
  xml: '',
  text: '',
  binary: ''
})
const formEntries = ref<RequestEntry[]>(parseKeyValueBody(props.request.body))
const binaryFile = ref<File | null>(null)

const tabCounts = computed<Record<string, number>>(() => ({
  Params: countEntries(props.request.queryParams),
  Headers: countEntries(props.request.headers),
  Cookies: countEntries(props.request.cookies),
  Auth: props.request.auth ? 1 : 0
}))

const bodyCount = computed(() => {
  if (activeBodyType.value === 'form-data' || activeBodyType.value === 'x-www-form-urlencoded') return countEntries(formEntries.value)
  if (activeBodyType.value === 'json' || activeBodyType.value === 'xml' || activeBodyType.value === 'text') return props.request.body.trim() ? 1 : 0
  if (activeBodyType.value === 'binary') return binaryFile.value ? 1 : 0
  return 0
})

watch(
  () => props.request.rawCommand,
  () => syncFromRequest(),
  { immediate: true }
)

watch(
  () => props.request.bodyType,
  (next) => {
    activeBodyType.value = next
  }
)

function syncFromRequest() {
  activeBodyType.value = props.request.bodyType
  bodyByType.value = {
    none: '',
    'form-data': '',
    'x-www-form-urlencoded': '',
    json: '',
    xml: '',
    text: '',
    binary: ''
  }
  bodyByType.value[props.request.bodyType] = props.request.body || ''
  formEntries.value = parseKeyValueBody(props.request.bodyType === 'form-data' || props.request.bodyType === 'x-www-form-urlencoded' ? props.request.body : '')
  emit('form-change', formEntries.value)
}

function selectBodyType(value: RequestBodyType) {
  bodyByType.value[activeBodyType.value] = props.request.body || ''
  activeBodyType.value = value
  props.request.bodyType = value
  props.request.body = value === 'none' || value === 'binary' ? '' : bodyByType.value[value] || ''
  if (value === 'form-data' || value === 'x-www-form-urlencoded') {
    formEntries.value = parseKeyValueBody(props.request.body)
    normalizeFormTypes()
    emit('form-change', formEntries.value)
  }
  emit('change')
}

function normalizeFormTypes() {
  if (activeBodyType.value === 'x-www-form-urlencoded') {
    formEntries.value.forEach((entry) => {
      if (entry.valueType === 'file') entry.valueType = 'string'
    })
  }
}

function onFormChange() {
  normalizeFormTypes()
  const body = new URLSearchParams(formEntries.value.filter((item) => item.enabled && item.key).map((item) => [item.key, item.value])).toString()
  bodyByType.value[activeBodyType.value] = body
  props.request.body = body
  emit('form-change', formEntries.value)
  emit('change')
}

function updateBody(value: string) {
  bodyByType.value[activeBodyType.value] = value
  props.request.body = value
  emit('change')
}

function formatJsonBody() {
  try {
    updateBody(JSON.stringify(JSON.parse(props.request.body || '{}'), null, 2))
  } catch {
    // Keep invalid JSON editable.
  }
}

function formatXmlBody() {
  import('xml-formatter').then(({ default: formatXml }) => {
    try {
      updateBody(formatXml(props.request.body || '', { indentation: '  ' }))
    } catch {
      // Keep invalid XML editable.
    }
  })
}

function onBinaryChange(event: Event) {
  const input = event.target as HTMLInputElement
  binaryFile.value = input.files?.[0] || null
  emit('binary-change', binaryFile.value)
}

function clearBinaryFile() {
  binaryFile.value = null
  emit('binary-change', null)
}

function setAuthType(type: 'none' | 'basic' | 'bearer') {
  if (type === 'none') {
    props.request.auth = undefined
  } else if (type === 'basic') {
    props.request.auth = { type: 'basic', username: props.request.auth?.username || '', password: props.request.auth?.password || '' }
  } else {
    props.request.auth = { type: 'bearer', token: props.request.auth?.token || '' }
  }
  emit('change')
}

function countEntries(entries: RequestEntry[]) {
  return entries.filter((entry) => entry.enabled && entry.key.trim()).length
}
</script>

<template>
  <section class="request-pane">
    <div class="request-line">
      <MethodDropdown v-model="request.method" />
      <input
        v-model="request.baseUrl"
        class="url-input"
        placeholder="https://api.example.com/resource"
        @input="emit('change')"
        @keyup.enter="emit('send')"
      />
      <button class="send-button" :disabled="sending" @click="emit('send')">{{ sending ? '发送中' : '发送' }}</button>
    </div>

    <div class="tabs">
      <button v-for="tab in requestTabs" :key="tab" :class="{ active: activeTab === tab }" @click="activeTab = tab">
        {{ tab }}
        <span v-if="tab !== 'Body' && tabCounts[tab]" class="count-badge">{{ tabCounts[tab] }}</span>
        <span v-if="tab === 'Body' && bodyCount" class="count-badge">{{ bodyCount }}</span>
      </button>
    </div>

    <div class="tab-body">
      <KeyValueTable v-if="activeTab === 'Params'" :entries="request.queryParams" key-label="参数名" value-label="参数值" @change="emit('change')" />
      <KeyValueTable v-else-if="activeTab === 'Headers'" :entries="request.headers" key-label="Header" value-label="Value" @change="emit('change')" />
      <KeyValueTable v-else-if="activeTab === 'Cookies'" :entries="request.cookies" key-label="Cookie" value-label="Value" @change="emit('change')" />

      <div v-else-if="activeTab === 'Auth'" class="auth-panel">
        <div class="auth-tabs">
          <button :class="{ active: !request.auth }" @click="setAuthType('none')">None</button>
          <button :class="{ active: request.auth?.type === 'basic' }" @click="setAuthType('basic')">Basic</button>
          <button :class="{ active: request.auth?.type === 'bearer' }" @click="setAuthType('bearer')">Bearer</button>
        </div>
        <div v-if="!request.auth" class="auth-empty">当前请求不使用认证。</div>
        <div v-else-if="request.auth.type === 'basic'" class="auth-form">
          <label>
            <span>Username</span>
            <input v-model="request.auth.username" placeholder="username" @input="emit('change')" />
          </label>
          <label>
            <span>Password</span>
            <input v-model="request.auth.password" type="password" placeholder="password" @input="emit('change')" />
          </label>
        </div>
        <div v-else class="auth-form">
          <label class="wide">
            <span>Bearer Token</span>
            <input v-model="request.auth.token" placeholder="token" @input="emit('change')" />
          </label>
        </div>
      </div>

      <div v-else class="body-panel">
        <div class="body-types">
          <button
            v-for="item in bodyTypes"
            :key="item.value"
            :class="{ active: activeBodyType === item.value }"
            @click="selectBodyType(item.value)"
          >
            {{ item.label }}
            <span v-if="item.value === activeBodyType && bodyCount" class="count-badge">{{ bodyCount }}</span>
          </button>
        </div>

        <div v-if="activeBodyType === 'none'" class="empty-note">当前请求不发送请求体。</div>
        <KeyValueTable
          v-else-if="activeBodyType === 'form-data' || activeBodyType === 'x-www-form-urlencoded'"
          :entries="formEntries"
          key-label="参数名"
          value-label="参数值"
          show-type
          :allow-file-type="activeBodyType === 'form-data'"
          @change="onFormChange"
        />
        <div v-else-if="activeBodyType === 'binary'" class="binary-upload">
          <label class="file-picker" :title="binaryFile?.name || '选择文件'">
            <FileUp :size="30" :stroke-width="1.45" />
            <span v-if="!binaryFile" class="upload-hint">点击上传</span>
            <span v-else class="file-name">{{ binaryFile.name }}</span>
            <input type="file" @change="onBinaryChange" />
          </label>
          <button v-if="binaryFile" class="binary-clear" title="移除附件" @click="clearBinaryFile">
            <X :size="15" :stroke-width="1.9" />
          </button>
        </div>
        <div v-else class="text-editor">
          <button v-if="activeBodyType === 'json'" class="format-button" title="格式化" @click="formatJsonBody">
            <WandSparkles :size="14" :stroke-width="1.7" />
          </button>
          <button v-else-if="activeBodyType === 'xml'" class="format-button" title="格式化" @click="formatXmlBody">
            <WandSparkles :size="14" :stroke-width="1.7" />
          </button>
          <JsonEditableBlock v-if="activeBodyType === 'json'" :content="request.body" @update:content="updateBody" />
          <XmlEditableBlock v-else-if="activeBodyType === 'xml'" :content="request.body" @update:content="updateBody" />
          <textarea v-else :value="request.body" spellcheck="false" @input="updateBody(($event.target as HTMLTextAreaElement).value)" />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.request-pane {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  min-height: 0;
  padding: 12px 14px 10px;
  background: #fff;
}

.request-line {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) 86px;
  gap: 8px;
  align-items: center;
}

.url-input {
  height: 34px;
  min-width: 0;
  box-sizing: border-box;
  padding: 0 11px;
  border: 1px solid #dbe2ea;
  border-radius: 7px;
  color: #0f172a;
  outline: none;
}

.url-input:focus {
  border-color: #a5b4fc;
}

.send-button {
  height: 34px;
  padding: 0 12px;
  border: 1px solid #4f46e5;
  border-radius: 7px;
  color: #fff;
  background: #4f46e5;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 18%),
    0 1px 2px rgb(15 23 42 / 8%);
  font-size: 13px;
  font-weight: 800;
  line-height: 1;
  cursor: pointer;
  transition:
    background 0.16s ease,
    border-color 0.16s ease,
    box-shadow 0.16s ease,
    transform 0.16s ease;
}

.send-button:hover:not(:disabled) {
  border-color: #4338ca;
  background: #4338ca;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 18%),
    0 2px 5px rgb(79 70 229 / 16%);
}

.send-button:active:not(:disabled) {
  box-shadow:
    inset 0 1px 2px rgb(49 46 129 / 24%),
    0 1px 2px rgb(15 23 42 / 8%);
}

.send-button:disabled {
  opacity: 0.58;
  cursor: not-allowed;
}

.tabs {
  display: flex;
  gap: 3px;
  height: 36px;
  margin-top: 8px;
  border-bottom: 1px solid #eef2f7;
}

.tabs button,
.body-types button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  color: #64748b;
  background: transparent;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.count-badge {
  display: inline-grid;
  place-items: center;
  min-width: 14px;
  height: 16px;
  box-sizing: border-box;
  padding: 0 4px;
  border-radius: 999px;
  color: #64748b;
  background: #eef2f7;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.tabs button.active .count-badge,
.body-types button.active .count-badge {
  color: #4f46e5;
  background: #e0e7ff;
}

.tabs button.active,
.tabs button:hover,
.body-types button.active,
.body-types button:hover {
  color: #4f46e5;
  background: #f5f3ff;
}

.tab-body {
  min-height: 0;
  overflow: hidden;
  padding-top: 10px;
}

.body-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 10px;
  height: 100%;
  min-height: 0;
}

.body-types {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.text-editor {
  position: relative;
  min-height: 0;
}

.text-editor textarea {
  width: 100%;
  height: 100%;
  min-height: 120px;
  box-sizing: border-box;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 7px;
  color: #0f172a;
  background: #fff;
  font-family: Consolas, 'SFMono-Regular', monospace;
  font-size: 12px;
  line-height: 1.6;
  outline: none;
  resize: none;
}

.format-button {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 5;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  color: #64748b;
  background: rgb(248 250 252 / 92%);
  box-shadow: 0 1px 2px rgb(15 23 42 / 6%);
  cursor: pointer;
  transition:
    color 0.16s ease,
    background 0.16s ease,
    border-color 0.16s ease,
    box-shadow 0.16s ease;
}

.format-button::after {
  position: absolute;
  top: 50%;
  right: calc(100% + 8px);
  padding: 4px 7px;
  border-radius: 6px;
  color: #475569;
  background: #fff;
  box-shadow: 0 8px 22px rgb(15 23 42 / 12%);
  content: '格式化';
  font-size: 12px;
  font-weight: 700;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-50%) translateX(4px);
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
  white-space: nowrap;
}

.format-button:hover::after {
  opacity: 1;
  transform: translateY(-50%);
}

.format-button:hover {
  border-color: #dbe2ea;
  color: #4f46e5;
  background: #eef2ff;
  box-shadow: 0 2px 6px rgb(15 23 42 / 8%);
}

.empty-note {
  display: grid;
  place-items: center;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  color: #64748b;
  background: #f8fafc;
  font-size: 12px;
}

.auth-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 10px;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  padding: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
}

.auth-tabs {
  display: inline-flex;
  width: fit-content;
  gap: 4px;
  padding: 3px;
  border-radius: 7px;
  background: #f8fafc;
}

.auth-tabs button {
  height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  color: #64748b;
  background: transparent;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.auth-tabs button.active,
.auth-tabs button:hover {
  color: #4f46e5;
  background: #fff;
  box-shadow: 0 1px 3px rgb(15 23 42 / 8%);
}

.auth-empty {
  display: grid;
  place-items: center;
  min-height: 96px;
  color: #94a3b8;
  font-size: 12px;
  font-weight: 500;
}

.auth-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  align-content: start;
}

.auth-form label {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.auth-form label.wide {
  grid-column: 1 / -1;
}

.auth-form span {
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.auth-form input {
  height: 32px;
  min-width: 0;
  box-sizing: border-box;
  padding: 0 9px;
  border: 1px solid #e2e8f0;
  border-radius: 7px;
  color: #0f172a;
  background: #fff;
  font-size: 12px;
  outline: none;
}

.auth-form input:focus {
  border-color: #a5b4fc;
}

.binary-upload {
  position: relative;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.file-picker {
  position: relative;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 8px;
  width: 100%;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  color: #4f46e5;
  background: #f8fafc;
  cursor: pointer;
  transition:
    border 0.16s ease,
    background 0.16s ease;
}

.file-picker:hover {
  border-color: #a5b4fc;
  background: #f5f3ff;
}

.file-picker input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.file-name {
  max-width: min(420px, 80%);
  overflow: hidden;
  color: #0f172a;
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.upload-hint {
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.binary-clear {
  position: absolute;
  top: 9px;
  right: 9px;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: #94a3b8;
  background: rgb(255 255 255 / 86%);
  cursor: pointer;
}

.binary-clear:hover {
  color: #ef4444;
  background: #fef2f2;
}
</style>
