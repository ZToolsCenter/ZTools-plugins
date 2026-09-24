<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import LoadingMask from './LoadingMask.vue'
import JsonView from './JsonView.vue'
import {
  DEFAULT_REST_SCRIPT,
  buildRequestPayload,
  parseRestScript,
  requestHasError,
  type RestScriptRequest,
} from '../services/restScript'
import {
  createRestEditor,
  setRestIndexNames,
  setRestMappingFields,
  type RestEditorHandle,
} from '../services/restMonaco'
import { validateRestScriptWithSchema } from '../services/restScriptSchema'
import { indexNamesFromRestPath } from '../services/restFieldHints'

const script = ref(DEFAULT_REST_SCRIPT)
const hydrated = ref(false)
let persistTimer: ReturnType<typeof setTimeout> | null = null
let mappingTimer: ReturnType<typeof setTimeout> | null = null

type RestPersisted = {
  script: string
  result: string
  resultTitle: string
}

async function persistRestState() {
  if (!hydrated.value || !window.services?.saveUiState) return
  try {
    await window.services.saveUiState(window.services.uiStateIds.rest, {
      script: script.value,
      result: result.value,
      resultTitle: resultTitle.value,
    } satisfies RestPersisted)
  } catch {
    // ignore
  }
}

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => { void persistRestState() }, 300)
}

async function hydrateRestState() {
  if (!window.services?.getUiState) return
  try {
    const saved = await window.services.getUiState<RestPersisted>(window.services.uiStateIds.rest)
    if (!saved || typeof saved !== 'object') return
    if (typeof saved.script === 'string' && saved.script.trim()) script.value = saved.script
    if (typeof saved.result === 'string') result.value = saved.result
    if (typeof saved.resultTitle === 'string' && saved.resultTitle) resultTitle.value = saved.resultTitle
  } catch {
    // ignore
  }
}

const loading = ref(false)
const runningId = ref('')
const transportError = ref('')
const formatMsg = ref('')
const result = ref('')
const resultTitle = ref('响应')
const editorHost = ref<HTMLElement | null>(null)
const gutterRef = ref<HTMLElement | null>(null)
const buttonTops = ref<Record<string, number>>({})
const mappingHintLabel = ref('')

let handle: RestEditorHandle | null = null
let scrollDisp: { dispose: () => void } | null = null
let lastMappingKey = ''

const analyzed = computed(() => validateRestScriptWithSchema(script.value))
const requests = computed(() => analyzed.value.requests)
const markers = computed(() => analyzed.value.markers)

const runButtons = computed(() =>
  requests.value.map((r) => ({
    id: r.id,
    line: r.headerLine,
    label: `${r.method} ${r.path}`,
    disabled: requestHasError(markers.value, r.id),
    req: r,
  })),
)

function syncRunButtonTops() {
  if (!handle) return
  const scroll = handle.getScrollTop()
  const next: Record<string, number> = {}
  for (const b of runButtons.value) {
    next[b.id] = handle.getTopForLine(b.line) - scroll
  }
  buttonTops.value = next
  if (gutterRef.value) gutterRef.value.scrollTop = 0
}

async function refreshIndexNameHints() {
  if (!window.services?.listIndices) return
  try {
    const res = await window.services.listIndices()
    if (!res.ok || !Array.isArray(res.body)) {
      setRestIndexNames([])
      return
    }
    const names = (res.body as Array<{ index?: string }>)
      .map((r) => r.index)
      .filter((n): n is string => typeof n === 'string' && !!n)
    setRestIndexNames(names)
  } catch {
    setRestIndexNames([])
  }
}

async function refreshMappingHints() {
  if (!window.services?.getMapping) return
  const reqs = parseRestScript(script.value)
  const names = new Set<string>()
  for (const r of reqs) {
    for (const n of indexNamesFromRestPath(r.path)) names.add(n)
  }
  const key = [...names].sort().join(',')
  if (key === lastMappingKey) return
  lastMappingKey = key
  if (!names.size) {
    setRestMappingFields([])
    mappingHintLabel.value = ''
    return
  }
  const fields: { path: string; type: string }[] = []
  const seen = new Set<string>()
  for (const name of names) {
    try {
      const res = await window.services.getMapping(name)
      if (!res.ok) continue
      for (const f of window.services.flattenMapping(res.body)) {
        if (seen.has(f.path)) continue
        seen.add(f.path)
        fields.push(f)
      }
    } catch {
      // ignore
    }
  }
  setRestMappingFields(fields)
  mappingHintLabel.value = fields.length
    ? `字段提示：${[...names].join(', ')} (${fields.length})`
    : `未加载到 mapping（${[...names].join(', ')}）`
}

function scheduleMappingHints() {
  if (mappingTimer) clearTimeout(mappingTimer)
  mappingTimer = setTimeout(() => { void refreshMappingHints() }, 400)
}

watch(script, () => {
  schedulePersist()
  scheduleMappingHints()
})
watch([result, resultTitle], () => schedulePersist())
watch(runButtons, () => nextTick(() => syncRunButtonTops()), { deep: true })

function flushPersist() {
  if (persistTimer) clearTimeout(persistTimer)
  void persistRestState()
}
onDeactivated(flushPersist)

onBeforeUnmount(() => {
  flushPersist()
  if (mappingTimer) clearTimeout(mappingTimer)
  scrollDisp?.dispose()
  handle?.dispose()
  handle = null
  setRestMappingFields([])
  setRestIndexNames([])
})

onMounted(async () => {
  try {
    window.ztools?.onPluginOut?.(() => { flushPersist() })
  } catch {}

  await hydrateRestState()
  hydrated.value = true

  if (editorHost.value) {
    handle = await createRestEditor(editorHost.value, script.value, (v) => {
      script.value = v
      nextTick(() => syncRunButtonTops())
    })
    scrollDisp = handle.onScroll(() => syncRunButtonTops())
    await nextTick()
    handle.layout()
    syncRunButtonTops()
  }
  schedulePersist()
  void refreshIndexNameHints()
  scheduleMappingHints()
})

async function runRequest(req: RestScriptRequest) {
  transportError.value = ''
  if (requestHasError(markers.value, req.id)) {
    transportError.value = '请先修复该请求的语法或结构错误'
    return
  }
  const payload = buildRequestPayload(req)
  if (payload.error) {
    transportError.value = `Body JSON 无效：${payload.error}`
    return
  }
  if (payload.method === 'DELETE' && !confirm(`确定发送 DELETE ${payload.path} ？`)) return

  loading.value = true
  runningId.value = req.id
  resultTitle.value = `${payload.method} ${payload.path}`
  try {
    const res = await window.services.request({
      method: payload.method,
      path: payload.path,
      body: payload.body,
    })
    result.value = JSON.stringify(
      { status: res.status, ok: res.ok, error: res.error, body: res.body },
      null,
      2,
    )
    if (!res.ok) transportError.value = res.error?.message || `HTTP ${res.status}`
  } finally {
    loading.value = false
    runningId.value = ''
  }
}

function insertSample() {
  const sample = `\n\nGET /_cat/indices?format=json\n`
  const next = script.value.replace(/\s*$/, '') + sample
  script.value = next
  handle?.setValue(next)
  void refreshIndexNameHints()
}

function formatScript() {
  if (!handle) return
  const { skipped } = handle.format()
  script.value = handle.getValue()
  formatMsg.value = skipped
    ? `已格式化（跳过 ${skipped} 段无效 JSON）`
    : '已格式化'
  setTimeout(() => { formatMsg.value = '' }, 2000)
  nextTick(() => syncRunButtonTops())
}
</script>

<template>
  <div class="rest-layout relative">
    <LoadingMask :show="loading" :text="'请求执行中…'" />

    <section class="panel rest-left">
      <div class="hrow rest-toolbar">
        <strong>请求脚本</strong>
        <div class="toolbar-actions">
          <button class="btn btn-sm btn-secondary" type="button" @click="formatScript">
            格式化
          </button>
          <button class="btn btn-sm btn-secondary" type="button" @click="insertSample">
            + 示例请求
          </button>
        </div>
      </div>
      <div class="muted tip">
        每个请求以 METHOD /path 开头，下接 JSON Body；点击 ▶ 执行。
        Ctrl+Space 触发补全：方法、索引路径、_search 属性与字段；Shift+Alt+F 格式化。
      </div>
      <div v-if="mappingHintLabel" class="muted tip">{{ mappingHintLabel }}</div>
      <div v-if="formatMsg" class="muted tip">{{ formatMsg }}</div>
      <div class="editor-shell">
        <div ref="gutterRef" class="gutter" aria-hidden="true">
          <button
            v-for="b in runButtons"
            :key="b.id"
            class="run-btn"
            type="button"
            :style="{ top: (buttonTops[b.id] ?? 0) + 'px' }"
            :disabled="loading || b.disabled"
            :title="b.disabled ? '存在错误，无法执行' : ('执行 ' + b.label)"
            @click="runRequest(b.req)"
          >
            {{ runningId === b.id ? '…' : '▶' }}
          </button>
        </div>
        <div ref="editorHost" class="editor-host" />
      </div>
      <div v-if="transportError" class="err" style="margin-top: 8px; white-space: pre-wrap">{{ transportError }}</div>
    </section>

    <section class="panel rest-right">
      <JsonView :title="resultTitle" :text="result" :empty="'执行左侧请求后在此查看响应'" />
    </section>
  </div>
</template>

<style scoped>
.rest-layout {
  position: relative;
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  gap: 12px;
  min-height: 480px;
  align-items: stretch;
}
.rest-left,
.rest-right {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}
.rest-toolbar {
  justify-content: space-between;
  margin-bottom: 6px;
}
.toolbar-actions {
  display: flex;
  gap: 6px;
}
.tip {
  font-size: 12px;
  margin-bottom: 8px;
}
.editor-shell {
  display: flex;
  flex: 1;
  min-height: 360px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--surface-2, var(--surface));
}
.gutter {
  position: relative;
  width: 36px;
  flex-shrink: 0;
  overflow: hidden;
  border-right: 1px solid var(--border);
  background: var(--surface);
}
.run-btn {
  position: absolute;
  left: 4px;
  width: 28px;
  height: 18px;
  padding: 0;
  line-height: 16px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--surface-2, var(--surface));
  color: var(--accent, #6ea8fe);
  cursor: pointer;
  z-index: 2;
}
.run-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.run-btn:not(:disabled):hover {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.editor-host {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.rest-right :deep(.json-view) {
  max-height: calc(100vh - 220px);
  overflow: auto;
}
@media (max-width: 900px) {
  .rest-layout {
    grid-template-columns: 1fr;
  }
}
</style>
