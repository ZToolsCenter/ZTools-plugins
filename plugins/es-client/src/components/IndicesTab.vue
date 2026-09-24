<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import LoadingMask from './LoadingMask.vue'
import JsonView from './JsonView.vue'
import FindableTextarea from './FindableTextarea.vue'
import {
  aliasChipColor,
  aliasesByIndex,
  validateIndexName,
} from '../services/indexMeta'
import {
  buildReindexBody,
  extractMappingsForClone,
  sanitizeIndexSettingsForClone,
} from '../services/indexClone'

type CatIndex = {
  health?: string
  status?: string
  index?: string
  uuid?: string
  pri?: string
  rep?: string
  'docs.count'?: string
  'store.size'?: string
}

const loading = ref(false)
const detailLoading = ref(false)
const saving = ref(false)
const error = ref('')
const indices = ref<CatIndex[]>([])
const aliasMap = ref<Record<string, string[]>>({})
const selected = ref('')
const detail = ref('')
const detailTitle = ref('')

const createOpen = ref(false)
const editOpen = ref(false)
const cloneOpen = ref(false)
const formError = ref('')
const maskText = ref('')

const createName = ref('')
const createShards = ref(1)
const createReplicas = ref(1)
const createMappings = ref('')

const editIndex = ref('')
const editReplicas = ref(1)
const editRefresh = ref('1s')
const editMappings = ref('')
const editAliases = ref<string[]>([])
const newAlias = ref('')

const cloneSource = ref('')
const cloneDest = ref('')

const sortedIndices = computed(() =>
  [...indices.value].sort((a, b) => String(a.index).localeCompare(String(b.index))),
)

function aliasesOf(index: string | undefined): string[] {
  if (!index) return []
  return aliasMap.value[index] ?? []
}

function chipStyle(name: string) {
  const c = aliasChipColor(name)
  return { background: c.bg, color: c.fg }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [idxRes, aliasRes] = await Promise.all([
      window.services.listIndices(),
      window.services.listAliases(),
    ])
    if (!idxRes.ok) throw new Error(idxRes.error?.message || `HTTP ${idxRes.status}`)
    indices.value = Array.isArray(idxRes.body) ? (idxRes.body as CatIndex[]) : []
    if (aliasRes.ok) {
      aliasMap.value = aliasesByIndex(aliasRes.body)
    } else {
      aliasMap.value = {}
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function showMapping(index: string) {
  selected.value = index
  detailLoading.value = true
  try {
    const res = await window.services.getMapping(index)
    detailTitle.value = `Mapping · ${index}`
    detail.value = JSON.stringify(res.ok ? res.body : res.error, null, 2)
  } finally {
    detailLoading.value = false
  }
}

async function showSettings(index: string) {
  selected.value = index
  detailLoading.value = true
  try {
    const res = await window.services.getIndexSettings(index)
    detailTitle.value = `Settings · ${index}`
    detail.value = JSON.stringify(res.ok ? res.body : res.error, null, 2)
  } finally {
    detailLoading.value = false
  }
}

function openCreate() {
  createName.value = ''
  createShards.value = 1
  createReplicas.value = 1
  createMappings.value = ''
  formError.value = ''
  createOpen.value = true
}

async function submitCreate() {
  formError.value = ''
  const nameErr = validateIndexName(createName.value)
  if (nameErr) {
    formError.value = nameErr
    return
  }
  let mappings: unknown
  if (createMappings.value.trim()) {
    try {
      mappings = JSON.parse(createMappings.value)
    } catch (e) {
      formError.value = `Mappings JSON 无效：${e instanceof Error ? e.message : e}`
      return
    }
  }
  saving.value = true
  maskText.value = '创建索引中…'
  try {
    const body: { settings: Record<string, unknown>; mappings?: unknown } = {
      settings: {
        number_of_shards: createShards.value,
        number_of_replicas: createReplicas.value,
      },
    }
    if (mappings !== undefined) body.mappings = mappings
    const res = await window.services.createIndex(createName.value.trim(), body)
    if (!res.ok) {
      formError.value = res.error?.message || `HTTP ${res.status}`
      return
    }
    window.services.toast(`已创建索引 ${createName.value.trim()}`, 'success')
    createOpen.value = false
    await load()
  } finally {
    saving.value = false
  }
}

async function openEdit(index: string) {
  editIndex.value = index
  formError.value = ''
  editMappings.value = ''
  newAlias.value = ''
  editAliases.value = [...aliasesOf(index)]
  editReplicas.value = 1
  editRefresh.value = '1s'
  editOpen.value = true

  detailLoading.value = true
  try {
    const res = await window.services.getIndexSettings(index)
    if (res.ok && res.body && typeof res.body === 'object') {
      const root = res.body as Record<string, { settings?: Record<string, unknown> }>
      const settings = root[index]?.settings ?? Object.values(root)[0]?.settings
      const idx = (settings?.index ?? settings) as Record<string, unknown> | undefined
      if (idx) {
        const rep = idx.number_of_replicas
        if (rep != null) editReplicas.value = Number(rep)
        const refresh = idx.refresh_interval
        if (typeof refresh === 'string') editRefresh.value = refresh
      }
    }
  } finally {
    detailLoading.value = false
  }
}

async function submitEdit() {
  formError.value = ''
  const index = editIndex.value
  saving.value = true
  maskText.value = '保存中…'
  try {
    const settingsRes = await window.services.updateIndexSettings(index, {
      index: {
        number_of_replicas: editReplicas.value,
        refresh_interval: editRefresh.value.trim() || '1s',
      },
    })
    if (!settingsRes.ok) {
      formError.value = settingsRes.error?.message || `Settings HTTP ${settingsRes.status}`
      return
    }

    if (editMappings.value.trim()) {
      let mappings: unknown
      try {
        mappings = JSON.parse(editMappings.value)
      } catch (e) {
        formError.value = `Mappings JSON 无效：${e instanceof Error ? e.message : e}`
        return
      }
      const mapRes = await window.services.putIndexMapping(index, mappings)
      if (!mapRes.ok) {
        formError.value = mapRes.error?.message || `Mapping HTTP ${mapRes.status}`
        return
      }
    }

    const current = new Set(aliasesOf(index))
    const next = new Set(editAliases.value.map((a) => a.trim()).filter(Boolean))
    const actions: unknown[] = []
    for (const a of next) {
      if (!current.has(a)) actions.push({ add: { index, alias: a } })
    }
    for (const a of current) {
      if (!next.has(a)) actions.push({ remove: { index, alias: a } })
    }
    if (actions.length) {
      const aliasRes = await window.services.updateAliases(actions)
      if (!aliasRes.ok) {
        formError.value = aliasRes.error?.message || `Aliases HTTP ${aliasRes.status}`
        return
      }
    }

    window.services.toast(`已更新索引 ${index}`, 'success')
    editOpen.value = false
    await load()
  } finally {
    saving.value = false
  }
}

function addAliasToEdit() {
  const a = newAlias.value.trim()
  if (!a) return
  if (!/^[a-z0-9][a-z0-9._\-]*$/.test(a)) {
    formError.value = '别名须小写，以字母或数字开头'
    return
  }
  if (!editAliases.value.includes(a)) editAliases.value.push(a)
  newAlias.value = ''
  formError.value = ''
}

function removeAliasFromEdit(a: string) {
  editAliases.value = editAliases.value.filter((x) => x !== a)
}

function openClone(index: string) {
  cloneSource.value = index
  cloneDest.value = `${index}_copy`
  formError.value = ''
  cloneOpen.value = true
}

async function submitClone() {
  formError.value = ''
  const source = cloneSource.value
  const dest = cloneDest.value.trim()
  const nameErr = validateIndexName(dest)
  if (nameErr) {
    formError.value = nameErr
    return
  }
  if (dest === source) {
    formError.value = '目标索引名不能与源索引相同'
    return
  }
  if (indices.value.some((r) => r.index === dest)) {
    formError.value = `索引 ${dest} 已存在`
    return
  }

  saving.value = true
  maskText.value = `克隆中：复制 settings / mapping…`
  try {
    const [setRes, mapRes] = await Promise.all([
      window.services.getIndexSettings(source),
      window.services.getMapping(source),
    ])
    if (!setRes.ok) {
      formError.value = setRes.error?.message || `Settings HTTP ${setRes.status}`
      return
    }
    if (!mapRes.ok) {
      formError.value = mapRes.error?.message || `Mapping HTTP ${mapRes.status}`
      return
    }

    const settings = sanitizeIndexSettingsForClone(setRes.body, source)
    const mappings = extractMappingsForClone(mapRes.body, source)
    const createBody: { settings: Record<string, unknown>; mappings?: Record<string, unknown> } = {
      settings: { index: settings },
    }
    if (Object.keys(mappings).length) createBody.mappings = mappings

    maskText.value = `克隆中：创建 ${dest}…`
    const createRes = await window.services.createIndex(dest, createBody)
    if (!createRes.ok) {
      formError.value = createRes.error?.message || `Create HTTP ${createRes.status}`
      return
    }

    maskText.value = `克隆中：复制文档 ${source} → ${dest}…`
    const reRes = await window.services.reindex(buildReindexBody(source, dest))
    if (!reRes.ok) {
      formError.value = reRes.error?.message || `Reindex HTTP ${reRes.status}`
      return
    }

    const total =
      reRes.body && typeof reRes.body === 'object' && 'total' in (reRes.body as object)
        ? Number((reRes.body as { total?: number }).total)
        : undefined
    window.services.toast(
      total != null
        ? `已克隆 ${source} → ${dest}（${total} 条）`
        : `已克隆 ${source} → ${dest}`,
      'success',
    )
    cloneOpen.value = false
    await load()
  } finally {
    saving.value = false
  }
}

async function removeIndex(index: string) {
  if (!confirm(`确定删除索引 ${index} ？此操作不可恢复。`)) return
  saving.value = true
  maskText.value = '删除中…'
  error.value = ''
  try {
    const res = await window.services.deleteIndex(index)
    if (!res.ok) {
      error.value = res.error?.message || `HTTP ${res.status}`
      return
    }
    window.services.toast(`已删除 ${index}`, 'success')
    if (selected.value === index) {
      selected.value = ''
      detail.value = ''
      detailTitle.value = ''
    }
    await load()
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="wrap relative">
    <LoadingMask
      :show="loading || detailLoading || saving"
      :text="saving ? (maskText || '保存中…') : detailLoading ? '加载详情中…' : '加载索引列表…'"
    />
    <div class="hrow" style="margin-bottom: 10px">
      <button class="btn btn-primary" type="button" :disabled="loading" @click="load">
        {{ loading ? '加载中…' : '刷新索引' }}
      </button>
      <button class="btn btn-secondary" type="button" @click="openCreate">新建索引</button>
      <span class="muted">共 {{ indices.length }} 个</span>
    </div>
    <div v-if="error" class="err">{{ error }}</div>
    <div class="split">
      <div class="panel scroll" style="max-height: 480px">
        <table class="table">
          <thead>
            <tr>
              <th>健康</th>
              <th>索引</th>
              <th>文档</th>
              <th>大小</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in sortedIndices"
              :key="row.index"
              :class="{ active: selected === row.index }"
            >
              <td>{{ row.health }}</td>
              <td>
                <div class="idx-cell">
                  <span class="mono">{{ row.index }}</span>
                  <span
                    v-for="a in aliasesOf(row.index)"
                    :key="a"
                    class="alias-chip"
                    :style="chipStyle(a)"
                    :title="a"
                  >{{ a }}</span>
                </div>
              </td>
              <td>{{ row['docs.count'] }}</td>
              <td>{{ row['store.size'] }}</td>
              <td class="hrow actions">
                <button class="btn btn-sm btn-secondary" type="button" @click="showMapping(row.index!)">mapping</button>
                <button class="btn btn-sm btn-secondary" type="button" @click="showSettings(row.index!)">settings</button>
                <button class="btn btn-sm btn-secondary" type="button" @click="openEdit(row.index!)">修改</button>
                <button class="btn btn-sm btn-secondary" type="button" :title="'克隆索引与全部文档'" @click="openClone(row.index!)">克隆</button>
                <button class="btn btn-sm btn-outline-danger" type="button" @click="removeIndex(row.index!)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="panel">
        <JsonView
          :title="detailTitle || '详情'"
          :text="detail"
          :empty="'选择索引查看 mapping / settings'"
        />
      </div>
    </div>

    <div v-if="createOpen" class="modal-backdrop-custom" @click.self="createOpen = false">
      <div class="modal-panel" role="dialog" aria-modal="true">
        <div class="hrow" style="margin-bottom: 12px; justify-content: space-between">
          <strong>新建索引</strong>
          <button class="btn btn-sm btn-secondary" type="button" @click="createOpen = false">关闭</button>
        </div>
        <label class="form-label">名称</label>
        <input v-model="createName" class="form-control form-control-sm mono" placeholder="my-index" />
        <div class="hrow" style="gap: 12px; margin-top: 10px">
          <div style="flex: 1">
            <label class="form-label">shards</label>
            <input v-model.number="createShards" class="form-control form-control-sm" type="number" min="1" />
          </div>
          <div style="flex: 1">
            <label class="form-label">replicas</label>
            <input v-model.number="createReplicas" class="form-control form-control-sm" type="number" min="0" />
          </div>
        </div>
        <label class="form-label" style="margin-top: 10px">Mappings JSON（可选）</label>
        <FindableTextarea
          v-model="createMappings"
          :rows="6"
          placeholder='{ "properties": { "title": { "type": "text" } } }'
        />
        <div v-if="formError" class="err" style="margin: 10px 0">{{ formError }}</div>
        <div class="hrow" style="justify-content: flex-end; gap: 8px; margin-top: 12px">
          <button class="btn btn-secondary" type="button" @click="createOpen = false">取消</button>
          <button class="btn btn-primary" type="button" :disabled="saving" @click="submitCreate">
            {{ saving ? '创建中…' : '创建' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="editOpen" class="modal-backdrop-custom" @click.self="editOpen = false">
      <div class="modal-panel modal-wide" role="dialog" aria-modal="true">
        <div class="hrow" style="margin-bottom: 12px; justify-content: space-between">
          <strong>修改索引 · {{ editIndex }}</strong>
          <button class="btn btn-sm btn-secondary" type="button" @click="editOpen = false">关闭</button>
        </div>

        <h6 class="section-title">Settings</h6>
        <div class="hrow" style="gap: 12px">
          <div style="flex: 1">
            <label class="form-label">number_of_replicas</label>
            <input v-model.number="editReplicas" class="form-control form-control-sm" type="number" min="0" />
          </div>
          <div style="flex: 1">
            <label class="form-label">refresh_interval</label>
            <input v-model="editRefresh" class="form-control form-control-sm mono" placeholder="1s" />
          </div>
        </div>

        <h6 class="section-title">追加 Mapping（可选）</h6>
        <FindableTextarea
          v-model="editMappings"
          :rows="5"
          placeholder='{ "properties": { "new_field": { "type": "keyword" } } }'
        />

        <h6 class="section-title">别名</h6>
        <div class="alias-edit-list">
          <span
            v-for="a in editAliases"
            :key="a"
            class="alias-chip alias-chip-edit"
            :style="chipStyle(a)"
          >
            {{ a }}
            <button type="button" class="chip-x" title="移除" @click="removeAliasFromEdit(a)">×</button>
          </span>
          <span v-if="!editAliases.length" class="muted">暂无别名</span>
        </div>
        <div class="hrow" style="gap: 8px; margin-top: 8px">
          <input
            v-model="newAlias"
            class="form-control form-control-sm mono"
            placeholder="新别名"
            @keydown.enter.prevent="addAliasToEdit"
          />
          <button class="btn btn-sm btn-secondary" type="button" @click="addAliasToEdit">添加</button>
        </div>

        <div v-if="formError" class="err" style="margin: 10px 0">{{ formError }}</div>
        <div class="hrow" style="justify-content: flex-end; gap: 8px; margin-top: 12px">
          <button class="btn btn-secondary" type="button" @click="editOpen = false">取消</button>
          <button class="btn btn-primary" type="button" :disabled="saving" @click="submitEdit">
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="cloneOpen" class="modal-backdrop-custom" @click.self="cloneOpen = false">
      <div class="modal-panel" role="dialog" aria-modal="true">
        <div class="hrow" style="margin-bottom: 12px; justify-content: space-between">
          <strong>克隆索引</strong>
          <button class="btn btn-sm btn-secondary" type="button" @click="cloneOpen = false">关闭</button>
        </div>
        <p class="muted tip">
          将复制 <span class="mono">{{ cloneSource }}</span> 的 settings、mapping 与全部文档到新索引（不复制别名）。
          大索引可能耗时较长。
        </p>
        <label class="form-label">源索引</label>
        <input class="form-control form-control-sm mono" :value="cloneSource" readonly />
        <label class="form-label" style="margin-top: 10px">新索引名</label>
        <input v-model="cloneDest" class="form-control form-control-sm mono" placeholder="my-index_copy" />
        <div v-if="formError" class="err" style="margin: 10px 0">{{ formError }}</div>
        <div class="hrow" style="justify-content: flex-end; gap: 8px; margin-top: 12px">
          <button class="btn btn-secondary" type="button" @click="cloneOpen = false">取消</button>
          <button class="btn btn-primary" type="button" :disabled="saving" @click="submitClone">
            {{ saving ? '克隆中…' : '开始克隆' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.relative { position: relative; min-height: 200px; }
.split { display: grid; grid-template-columns: 1.2fr 1fr; gap: 12px; }
@media (max-width: 900px) { .split { grid-template-columns: 1fr; } }
.idx-cell {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.alias-chip {
  display: inline-block;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  line-height: 1.4;
  vertical-align: middle;
}
.alias-chip-edit {
  max-width: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.chip-x {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0 2px;
  font-size: 14px;
  line-height: 1;
  opacity: 0.85;
}
.chip-x:hover { opacity: 1; }
.alias-edit-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 28px;
  align-items: center;
}
.actions { flex-wrap: wrap; gap: 4px; }
.section-title {
  margin: 14px 0 8px;
  font-size: 13px;
  font-weight: 600;
}
.modal-wide { max-width: 560px; }
.tip { font-size: 12px; margin-bottom: 10px; }
</style>
