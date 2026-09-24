<script setup lang="ts">
import { computed, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import type { MappingField } from '../types'
import {
  buildSearchBody,
  newCondition,
  newGroup,
  type QueryGroup,
} from '../services/queryBuilder'
import { applySearchRequestText, formatSearchRequestText } from '../services/searchRequestText'
import ConditionGroup from './ConditionGroup.vue'
import LoadingMask from './LoadingMask.vue'
import SearchableSelect from './SearchableSelect.vue'
import JsonView from './JsonView.vue'
import FindableTextarea from './FindableTextarea.vue'

const PLACE_NEW = '新建文档'
const PLACE_VIEW = '查看文档'
const PLACE_EDIT = '编辑文档'
const PLACE_APPLIED = '已应用到条件'
const PLACE_PICKIDX = '请选择索引'
const PLACE_PICKFIRST = '请先选择索引'
const PLACE_DOCSAVED = '文档已保存'
const PLACE_DELETED = '已删除'
const PLACE_CONFIRM = '确定删除'
const PLACE_JSONBAD = 'JSON 无效'

type DocMode = 'view' | 'edit' | 'create'
type Hit = { _id?: string; _score?: number; _source?: Record<string, unknown> }

const indices = ref<string[]>([])
const index = ref('')
const fields = ref<MappingField[]>([])
const root = ref<QueryGroup>(newGroup({ children: [] }))
const size = ref(20)
const page = ref(1)
const loading = ref(false)
const booting = ref(false)
const docBusy = ref(false)
const error = ref('')
const result = ref<unknown>(null)
const viewMode = ref<'table' | 'raw'>('table')
const dslText = ref('')
const dslError = ref('')
const dslOpen = ref(false)
const modalOpen = ref(false)
const modalMode = ref<DocMode>('view')
const modalId = ref('')
const modalBody = ref('{\n  \n}')
const modalError = ref('')
const suppressIndexWatch = ref(false)
const hydrated = ref(false)
let persistTimer: ReturnType<typeof setTimeout> | null = null

type SearchPersisted = {
  index: string
  size: number
  page: number
  viewMode: 'table' | 'raw'
  root: QueryGroup
  result: unknown
  dslText: string
}

async function persistSearchState() {
  if (!hydrated.value || !window.services?.saveUiState) return
  try {
    await window.services.saveUiState(window.services.uiStateIds.search, {
      index: index.value,
      size: size.value,
      page: page.value,
      viewMode: viewMode.value,
      root: root.value,
      result: result.value,
      dslText: dslText.value,
    } satisfies SearchPersisted)
  } catch {
    // db optional in some hosts
  }
}

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => { void persistSearchState() }, 300)
}

async function hydrateSearchState(): Promise<boolean> {
  if (!window.services?.getUiState) return false
  try {
    const saved = await window.services.getUiState<SearchPersisted>(window.services.uiStateIds.search)
    if (!saved || typeof saved !== 'object') return false
    if (saved.root && typeof saved.root === 'object') root.value = saved.root
    if (typeof saved.size === 'number' && saved.size > 0) size.value = saved.size
    if (typeof saved.page === 'number' && saved.page > 0) page.value = saved.page
    if (saved.viewMode === 'table' || saved.viewMode === 'raw') viewMode.value = saved.viewMode
    if (typeof saved.dslText === 'string') dslText.value = saved.dslText
    if (saved.result !== undefined) result.value = saved.result
    if (typeof saved.index === 'string') {
      suppressIndexWatch.value = true
      index.value = saved.index
      suppressIndexWatch.value = false
    }
    return true
  } catch {
    return false
  }
}

const dslCopied = ref(false)
const modalCopied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null

const from = computed(() => Math.max(0, (page.value - 1) * size.value))
const fieldOptions = computed(() => fields.value.map((f) => ({ value: f.path, label: `${f.path} (${f.type})` })))
const generated = computed(() => buildSearchBody({ root: root.value, size: size.value, from: from.value }))
watch(generated, (g) => {
  if (!dslOpen.value || g.errors.length) return
  dslText.value = formatSearchRequestText(index.value, g.body)
}, { deep: true })
const hits = computed(() => ((result.value as { hits?: { hits?: Hit[] } } | null)?.hits?.hits ?? []))
const total = computed(() => {
  const t = (result.value as { hits?: { total?: number | { value?: number } } })?.hits?.total
  return typeof t === 'number' ? t : t?.value
})
const totalPages = computed(() => total.value == null ? 1 : Math.max(1, Math.ceil(total.value / size.value)))
const columns = computed(() => {
  const keys = new Set<string>()
  for (const h of hits.value) Object.keys(h._source ?? {}).forEach((k) => keys.add(k))
  return [...keys].slice(0, 10)
})
const modalTitle = computed(() => modalMode.value === 'create' ? PLACE_NEW : modalMode.value === 'view' ? PLACE_VIEW : PLACE_EDIT)

function clearConditions() {
  root.value = newGroup({ children: [], combine: 'must' })
}
function addCondition() {
  root.value.children.push(newCondition())
}
function parseIndexNames(body: unknown): string[] {
  let data: unknown = body
  if (typeof data === 'string') {
    try { data = JSON.parse(data) } catch { return [] }
  }
  if (!Array.isArray(data)) return []
  return data
    .map((row) => {
      if (typeof row === 'string') return row
      if (row && typeof row === 'object' && 'index' in row) {
        const v = (row as { index?: unknown }).index
        return v == null ? '' : String(v)
      }
      return ''
    })
    .map((s) => s.trim())
    .filter(Boolean)
}

async function copyText(text: string, kind: 'dsl' | 'modal') {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
  if (kind === 'dsl') dslCopied.value = true
  else modalCopied.value = true
  try { window.services.toast('已复制', 'success') } catch {}
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    dslCopied.value = false
    modalCopied.value = false
  }, 1500)
}

function formatCell(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
function syncDslFromBuilder() {
  const { body, errors } = generated.value
  if (errors.length) return
  dslText.value = formatSearchRequestText(index.value, body)
}
function openDsl() { dslError.value = ''; syncDslFromBuilder(); dslOpen.value = true }
function closeDsl() { dslOpen.value = false }

async function applyDsl() {
  dslError.value = ''
  if (!indices.value.length) await loadIndices()
  const resultApply = applySearchRequestText(dslText.value, {
    availableIndices: indices.value,
    fields: fields.value,
    fallbackIndex: index.value,
  })
  const warnPrefix = '警告'
  if (!resultApply.ok) {
    dslError.value = [...resultApply.errors, ...resultApply.warnings.map((w) => warnPrefix + w)].join('\n')
    return
  }
  const nextIndex = resultApply.envelope?.index?.trim() || ''
  if (nextIndex && nextIndex !== index.value) {
    suppressIndexWatch.value = true
    index.value = nextIndex
    suppressIndexWatch.value = false
    clearConditions()
    await loadMapping()
    const again = applySearchRequestText(dslText.value, {
      availableIndices: indices.value,
      fields: fields.value,
      fallbackIndex: index.value,
    })
    if (!again.ok || !again.root) {
      dslError.value = [...(again.errors.length ? again.errors : resultApply.errors), ...again.warnings.map((w) => warnPrefix + w)].join('\n')
      return
    }
    root.value = again.root
    if (typeof again.size === 'number' && again.size > 0) size.value = again.size
    if (typeof again.from === 'number' && again.from >= 0) page.value = Math.floor(again.from / size.value) + 1
    window.services.toast(again.warnings[0] || PLACE_APPLIED, again.warnings.length ? 'info' : 'success')
    closeDsl()
    return
  }
  root.value = resultApply.root!
  if (typeof resultApply.size === 'number' && resultApply.size > 0) size.value = resultApply.size
  if (typeof resultApply.from === 'number' && resultApply.from >= 0) page.value = Math.floor(resultApply.from / size.value) + 1
  window.services.toast(resultApply.warnings[0] || PLACE_APPLIED, resultApply.warnings.length ? 'info' : 'success')
  closeDsl()
}

async function loadIndices() {
  booting.value = true; error.value = ''
  try {
    const res = await window.services.listIndices()
    if (!res.ok) { error.value = res.error?.message || `HTTP ${res.status}`; indices.value = []; return }
    const names = parseIndexNames(res.body)
    indices.value = names
    if (!names.length) {
      suppressIndexWatch.value = true
      index.value = ''
      suppressIndexWatch.value = false
      return
    }
    if (!index.value || !names.includes(index.value)) {
      suppressIndexWatch.value = true
      index.value = names[0]
      suppressIndexWatch.value = false
    }
  } finally { booting.value = false }
}
async function loadMapping() {
  if (!index.value) { fields.value = []; return }
  booting.value = true
  try {
    const res = await window.services.getMapping(index.value)
    if (res.ok) fields.value = window.services.flattenMapping(res.body)
    else fields.value = []
  } finally { booting.value = false }
}
async function runSearch(resetPage = false) {
  error.value = ''; if (resetPage) page.value = 1
  if (!index.value) { error.value = PLACE_PICKIDX; return }
  const { body, errors } = buildSearchBody({ root: root.value, size: size.value, from: resetPage ? 0 : from.value })
  if (errors.length) { error.value = errors.join('\n'); return }
  loading.value = true
  try {
    const res = await window.services.search(index.value, body)
    if (!res.ok) { error.value = res.error?.reason || res.error?.message || `HTTP ${res.status}`; result.value = res.body; return }
    result.value = res.body
  } finally { loading.value = false }
}
async function goPage(next: number) { if (next < 1 || next > totalPages.value) return; page.value = next; await runSearch(false) }
function openCreate() { modalMode.value = 'create'; modalId.value = ''; modalBody.value = '{\n  \n}'; modalError.value = ''; modalOpen.value = true }
function openView(hit: Hit) { modalMode.value = 'view'; modalId.value = hit._id ?? ''; modalBody.value = JSON.stringify(hit._source ?? {}, null, 2); modalError.value = ''; modalOpen.value = true }
function openEdit(hit: Hit) { modalMode.value = 'edit'; modalId.value = hit._id ?? ''; modalBody.value = JSON.stringify(hit._source ?? {}, null, 2); modalError.value = ''; modalOpen.value = true }
function closeModal() { modalOpen.value = false }
async function saveDoc() {
  modalError.value = ''
  if (!index.value) { modalError.value = PLACE_PICKFIRST; return }
  try {
    const body = JSON.parse(modalBody.value || '{}')
    docBusy.value = true
    const res = await window.services.indexDoc(index.value, modalId.value || null, body)
    if (!res.ok) { modalError.value = res.error?.message || `HTTP ${res.status}`; return }
    const newId = (res.body as { _id?: string })?._id
    if (newId) modalId.value = newId
    window.services.toast(PLACE_DOCSAVED, 'success'); modalOpen.value = false; await runSearch(false)
  } catch (e) {
    modalError.value = e instanceof Error ? PLACE_JSONBAD + '：' + e.message : PLACE_JSONBAD
  } finally { docBusy.value = false }
}
async function removeDoc(hit: Hit) {
  const id = hit._id
  if (!id || !index.value) return
  if (!confirm(PLACE_CONFIRM + ' ' + index.value + '/_doc/' + id + ' ?')) return
  docBusy.value = true; error.value = ''
  try {
    const res = await window.services.deleteDoc(index.value, id)
    if (!res.ok) { error.value = res.error?.message || `HTTP ${res.status}`; return }
    window.services.toast(PLACE_DELETED, 'success'); await runSearch(false)
  } finally { docBusy.value = false }
}

watch(index, () => {
  if (suppressIndexWatch.value) {
    void loadMapping()
    return
  }
  clearConditions()
  result.value = null
  void loadMapping()
})

watch(
  [index, size, page, viewMode, root, result, dslText],
  () => schedulePersist(),
  { deep: true },
)

function flushPersist() {
  if (persistTimer) clearTimeout(persistTimer)
  void persistSearchState()
}
onDeactivated(flushPersist)
onBeforeUnmount(flushPersist)

onMounted(async () => {
  try {
    window.ztools?.onPluginOut?.(() => { flushPersist() })
  } catch {}

  const restored = await hydrateSearchState()
  if (!restored) clearConditions()
  hydrated.value = true
  await loadIndices()
  // keep restored index if still available
  if (restored && index.value && indices.value.length && !indices.value.includes(index.value)) {
    // leave as-is so user sees previous choice; mapping may fail until refresh
  }
  await loadMapping()
  schedulePersist()
})
</script>

<template>
  <div class="wrap relative">
    <LoadingMask
      :show="booting || loading || docBusy"
      :text="loading ? '查询中…' : docBusy ? '保存文档中…' : '加载/操作中'"
    />

    <section class="panel stack-gap">
      <div class="hrow toolbar">
        <label class="muted shrink">索引</label>
        <SearchableSelect v-model="index" :options="indices" width="220px" placeholder="选择索引" />
        <label class="muted shrink">每页</label>
        <input v-model.number="size" class="form-control form-control-sm size-input" type="number" min="1" max="200" />
        <button class="btn btn-sm btn-secondary" type="button" :disabled="booting" @click="loadIndices">刷新</button>
        <button class="btn btn-sm btn-secondary" type="button" @click="addCondition">增加查询条件</button>
        <button class="btn btn-sm btn-primary" type="button" :disabled="loading || booting" @click="runSearch(true)">
          {{ loading ? '查询中' : '查询' }}
        </button>
        <button class="btn btn-sm btn-secondary" type="button" :disabled="!index" @click="openCreate">新建文档</button>
        <button class="btn btn-sm btn-secondary" type="button" @click="openDsl">查看 JSON</button>
      </div>

      <ConditionGroup v-if="root.children.length" :group="root" :field-options="fieldOptions" />
      <div v-else class="muted tip">可不填条件直接查询（match_all）；切换/进入索引会清空条件。</div>
      <div class="muted tip">查看 JSON 为 GET /index/_search + Body；可编辑后应用到条件。</div>
    </section>

    <section class="panel stack-gap" style="margin-top: 12px">
      <div class="hrow toolbar" style="justify-content: space-between">
        <strong>结果<span v-if="total !== undefined" class="muted"> · 共 {{ total }}</span></strong>
        <div class="hrow">
          <button class="btn btn-sm" type="button" :class="viewMode === 'table' ? 'btn-primary' : 'btn-secondary'" @click="viewMode = 'table'">表格</button>
          <button class="btn btn-sm" type="button" :class="viewMode === 'raw' ? 'btn-primary' : 'btn-secondary'" @click="viewMode = 'raw'">原始 JSON</button>
        </div>
      </div>
      <div v-if="error" class="err">{{ error }}</div>
      <template v-if="viewMode === 'table'">
        <div v-if="!hits.length" class="muted">暂无数据</div>
        <div v-else class="scroll" style="max-height: 420px">
          <table class="table">
            <thead>
              <tr>
                <th>_id</th><th>_score</th>
                <th v-for="col in columns" :key="col">{{ col }}</th>
                <th style="width: 150px">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="h in hits" :key="h._id">
                <td class="mono">{{ h._id }}</td>
                <td>{{ h._score }}</td>
                <td v-for="col in columns" :key="col" class="mono">{{ formatCell(h._source?.[col]) }}</td>
                <td>
                  <div class="hrow actions">
                    <button class="btn btn-sm btn-secondary" type="button" @click="openView(h)">查看</button>
                    <button class="btn btn-sm btn-secondary" type="button" @click="openEdit(h)">编辑</button>
                    <button class="btn btn-sm btn-danger" type="button" @click="removeDoc(h)">删除</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <JsonView v-else :title="'原始 JSON'" :value="result" />
      <div v-if="result" class="hrow pager">
        <button class="btn btn-sm btn-secondary" type="button" :disabled="page <= 1 || loading" @click="goPage(page - 1)">上一页</button>
        <span class="muted">第 {{ page }} / {{ totalPages }} 页</span>
        <button class="btn btn-sm btn-secondary" type="button" :disabled="page >= totalPages || loading" @click="goPage(page + 1)">下一页</button>
      </div>
    </section>

    <div v-if="modalOpen" class="modal-backdrop-custom" @click.self="closeModal">
      <div class="modal-panel" role="dialog" aria-modal="true">
        <div class="hrow" style="justify-content: space-between; margin-bottom: 10px">
          <strong>{{ modalTitle }}</strong>
          <button class="btn btn-sm btn-secondary" type="button" @click="closeModal">关闭</button>
        </div>
        <div class="field">
          <label>_id</label>
          <input v-model="modalId" class="form-control form-control-sm mono" :readonly="modalMode !== 'create'" :placeholder="modalMode === 'create' ? '可空（自动生成）' : ''" />
        </div>
        <div class="field">
          <div class="hrow" style="justify-content: space-between; margin-bottom: 4px">
            <label style="margin:0">_source JSON</label>
            <button class="btn btn-sm btn-secondary" type="button" @click="copyText(modalBody, 'modal')">{{ modalCopied ? '已复制' : '复制' }}</button>
          </div>
          <FindableTextarea v-model="modalBody" :rows="14" :readonly="modalMode === 'view'" />
        </div>
        <div v-if="modalError" class="err" style="margin-bottom: 10px">{{ modalError }}</div>
        <div class="hrow">
          <button v-if="modalMode !== 'view'" class="btn btn-primary" type="button" :disabled="docBusy" @click="saveDoc">{{ docBusy ? '保存中…' : '保存' }}</button>
          <button v-if="modalMode === 'view'" class="btn btn-primary" type="button" @click="modalMode = 'edit'">编辑</button>
          <button class="btn btn-secondary" type="button" @click="closeModal">关闭</button>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div class="drawer-root" :class="{ open: dslOpen }">
        <div class="drawer-mask" @click="closeDsl" />
        <aside class="drawer-panel" role="dialog" aria-label="查询 JSON">
          <div class="hrow drawer-head">
            <strong>查询 JSON</strong>
            <div class="hrow">
              <button class="btn btn-sm btn-secondary" type="button" @click="copyText(dslText, 'dsl')">{{ dslCopied ? '已复制' : '复制' }}</button>
              <button class="btn btn-sm btn-secondary" type="button" @click="closeDsl">关闭</button>
            </div>
          </div>
          <div class="muted tip" style="margin:0">格式：GET /your-index/_search + JSON Body</div>
          <FindableTextarea v-model="dslText" :rows="16" class="form-control mono drawer-editor" />
          <div v-if="dslError" class="err" style="margin: 8px 0; white-space: pre-wrap">{{ dslError }}</div>
          <div class="hrow drawer-actions">
            <button class="btn btn-sm btn-primary" type="button" @click="applyDsl">应用到条件</button>
            <button class="btn btn-sm btn-secondary" type="button" @click="syncDslFromBuilder">从条件生成</button>
          </div>
        </aside>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.relative { position: relative; min-height: 240px; }
.stack-gap { display: flex; flex-direction: column; gap: 10px; }
.toolbar { gap: 6px; flex-wrap: wrap; align-items: center; overflow: visible; width: 100%; }
.toolbar .shrink { flex: 0 0 auto; white-space: nowrap; }
.toolbar .size-input { width: 64px; flex: 0 0 64px; }
.actions { flex-wrap: nowrap; }
.pager { justify-content: flex-end; }
.tip { font-size: 12px; }
</style>

<style>
.drawer-root { pointer-events: none; }
.drawer-root.open { pointer-events: auto; }
.drawer-mask { position: fixed; inset: 0; z-index: 50; background: rgba(0,0,0,.35); opacity: 0; transition: opacity .2s ease; }
.drawer-root.open .drawer-mask { opacity: 1; }
.drawer-panel {
  position: fixed; top: 0; right: 0; z-index: 51; width: min(460px, 94vw); height: 100%;
  display: flex; flex-direction: column; gap: 10px; padding: 14px;
  background: var(--surface, #181b21); border-left: 1px solid var(--border, #2a2f38);
  box-shadow: var(--shadow, -4px 0 24px rgba(0,0,0,.3)); color: var(--text, #e6e8ec);
  transform: translateX(100%); transition: transform .22s ease;
}
.drawer-root.open .drawer-panel { transform: translateX(0); }
.drawer-head { justify-content: space-between; flex-shrink: 0; }
.drawer-editor { flex: 1; min-height: 0; resize: none; font-family: var(--mono, monospace); font-size: 12px; }
.drawer-actions { flex-shrink: 0; }
</style>
