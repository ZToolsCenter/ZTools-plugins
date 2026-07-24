<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import Fuse from 'fuse.js'
import { useRouter } from '../stores/router'
import { usePromptStore } from '../stores/prompt'
import { useProjectStore } from '../stores/project'
import { extractVariables } from '../utils/index'
import type { PromptItem, Variable, PromptType } from '../types'
import { showNotification } from '../utils/platform'

const router = useRouter()
const prompt = usePromptStore()
const projectStore = useProjectStore()

const selectedId = ref('')
const editTab = ref<'content' | 'props' | 'vars' | 'versions' | 'stats'>('content')
const editBody = ref('')
const editTitle = ref('')
const editTags = ref<string[]>([])
const tagInput = ref('')
const editVars = ref<Variable[]>([])
const editType = ref<PromptType>('prompt')
const editProjectId = ref('')

// 多选
const selectedIds = ref<Set<string>>(new Set())
const selectMode = ref(false)

// 筛选
const filterType = ref<string>('')
const filterScope = ref<string>('')

// 快照
const viewingSnapshot = ref<number | null>(null)

const selectedUnit = computed(() => prompt.rawItems.value.find(i => i.id === selectedId.value) || null)

const baseItems = computed(() => {
  let items = prompt.liveItems.value
  if (filterType.value) items = items.filter(i => i.type === filterType.value)
  if (filterScope.value === 'project') items = items.filter(i => i.projectId)
  else if (filterScope.value === 'asset') items = items.filter(i => !i.projectId)
  return items
})

const fuseInstance = computed(() => new Fuse(baseItems.value, {
  keys: ['title', 'content', 'tags'],
  threshold: 0.4,
  ignoreLocation: true,
  minMatchCharLength: 1,
}))

const filteredItems = computed(() => {
  const q = prompt.query.value.trim()
  if (!q) return baseItems.value
  return fuseInstance.value.search(q).map(r => r.item)
})

watch(selectedUnit, (u) => {
  if (!u) return
  editBody.value = u.content || ''; editTitle.value = u.title || ''
  editTags.value = [...(u.tags || [])]
  editVars.value = u.variables ? JSON.parse(JSON.stringify(u.variables)) : []
  editType.value = (u.type as PromptType) || 'prompt'
  editProjectId.value = u.projectId || ''
  viewingSnapshot.value = null
}, { immediate: true })

function addTag() { const t = tagInput.value.trim(); if (t && !editTags.value.includes(t)) editTags.value.push(t); tagInput.value = '' }
function removeTag(t: string) { editTags.value = editTags.value.filter(x => x !== t) }
function addVar() { editVars.value.push({ name: `var_${editVars.value.length + 1}`, required: true, defaultValue: '' }) }
function removeVar(i: number) { editVars.value.splice(i, 1) }

function toggleFavorite(id: string) { prompt.toggleFavorite(id) }

function toggleSelect(id: string) {
  const s = new Set(selectedIds.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  selectedIds.value = s
}

function selectAll() {
  const items = filteredItems.value
  if (selectedIds.value.size === items.length) { selectedIds.value = new Set() }
  else { selectedIds.value = new Set(items.map(i => i.id)) }
}

function batchDelete() {
  if (!selectedIds.value.size) return
  if (!confirm(`确定删除选中的 ${selectedIds.value.size} 项？`)) return
  let changed = false
  const now = Date.now()
  prompt.rawItems.value.forEach(item => {
    if (selectedIds.value.has(item.id)) {
      item.deleted = true
      item.updatedAt = now
      changed = true
    }
  })
  if (changed) prompt.persistAll()
  selectedIds.value = new Set()
  showNotification('✓ 已删除')
}

function batchMoveProject(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  if (!v) return
  let changed = false
  const now = Date.now()
  prompt.rawItems.value.forEach(item => {
    if (selectedIds.value.has(item.id)) {
      item.projectId = v
      item.updatedAt = now
      changed = true
    }
  })
  if (changed) prompt.persistAll()
  ;(e.target as HTMLSelectElement).value = ''
  showNotification('✓ 已移入项目')
}

function selectItem(id: string) {
  if (selectMode.value) { toggleSelect(id) } else { selectedId.value = id; editTab.value = 'content' }
}

function formatTime(ts: number) { return new Date(ts).toLocaleString('zh-CN') }

function restoreSnapshot(snap: { version: number; body: string }) {
  if (!selectedUnit.value) return
  if (!confirm(`恢复到 v${snap.version} 的内容？`)) return
  const u = selectedUnit.value
  const now = Date.now()
  const snapshots = u.snapshots ? [...u.snapshots] : []
  // 先把当前版本存为快照，这样恢复后还能找回
  snapshots.push({
    version: u.version || 1,
    body: u.content,
    note: `保存于恢复前`,
    createdAt: now,
  })
  // 从快照内容重新提取变量（只保留模板中实际存在的变量）
  const detected = extractVariables(snap.body)
  const vars: Variable[] = detected.map(d => {
    const existing = u.variables?.find(v => v.name === d.name)
    return { name: d.name, required: existing?.required ?? d.required, defaultValue: existing?.defaultValue ?? d.defaultValue }
  })
  const newVersion = (u.version || 1) + 1
  prompt.updateItem(u.id, {
    content: snap.body,
    variables: vars,
    version: newVersion,
    snapshots,
  })
  editBody.value = snap.body
  editVars.value = vars
  showNotification(`✓ 已恢复 v${snap.version} 的内容 → 当前 v${newVersion}`)
}

async function saveEdit() {
  const u = selectedUnit.value; if (!u) return
  const bodyChanged = editBody.value !== u.content
  const detected = extractVariables(editBody.value)
  const seen = new Set<string>()
  const vars: Variable[] = []
  for (const d of detected) {
    const existing = editVars.value.find(v => v.name === d.name)
    vars.push({ name: d.name, required: existing?.required ?? d.required, defaultValue: existing?.defaultValue ?? d.defaultValue })
    seen.add(d.name)
  }
  for (const v of editVars.value) { if (!seen.has(v.name)) { vars.push({ ...v }); seen.add(v.name) } }
  const newVersion = bodyChanged ? (u.version || 1) + 1 : (u.version || 1)
  const now = Date.now()
  const snapshots = u.snapshots ? [...u.snapshots] : []
  if (bodyChanged) {
    snapshots.push({
      version: u.version || 1,
      body: u.content,
      note: `编辑前保存`,
      createdAt: now,
    })
  }
  prompt.updateItem(u.id, {
    title: editTitle.value.trim() || u.title,
    content: editBody.value, tags: editTags.value, variables: vars,
    type: editType.value, projectId: editProjectId.value || undefined,
    version: newVersion,
    snapshots,
  })
  showNotification('✓ 保存成功')
}

async function deleteUnit() {
  const u = selectedUnit.value; if (!u) return
  if (!confirm(`确定删除「${u.title}」？`)) return
  prompt.softDelete(u.id); selectedId.value = ''
}

onMounted(() => {
  prompt.ensureReady()
  projectStore.ensureReady()
  // 检查是否有从空间视图传来的编辑 ID
  const editId = router.consumeManageEditId()
  if (editId) {
    selectedId.value = editId
    editTab.value = 'content'
  }
})
</script>

<template>
  <div class="manage">
    <div class="m-sidebar">
      <div class="m-head">
        <input v-model="prompt.query.value" class="m-search" placeholder="搜索…" />
        <div class="m-head-actions">
          <button :class="['btn', 'btn-xs', { active: selectMode }]" @click="selectMode = !selectMode; selectedIds = new Set()">
            {{ selectMode ? '取消' : '多选' }}
          </button>
          <button v-if="selectMode && selectedIds.size > 0" class="btn btn-xs danger" @click="batchDelete">
            删除 ({{ selectedIds.size }})
          </button>
        </div>
      </div>
      <div class="m-filters">
        <select v-model="filterType" class="m-filter-select">
          <option value="">全部类型</option>
          <option value="prompt">提示词</option>
          <option value="snippet">片段</option>
          <option value="template">模板</option>
          <option value="constraint">约束</option>
        </select>
        <select v-model="filterScope" class="m-filter-select">
          <option value="">全部归属</option>
          <option value="project">项目</option>
          <option value="asset">资产</option>
        </select>
      </div>
      <div v-if="selectMode && selectedIds.size > 0" class="m-batch-bar">
        <span class="batch-info">已选 {{ selectedIds.size }} 项</span>
        <button class="btn btn-xs" @click="selectAll">全选</button>
        <select class="batch-project" @change="batchMoveProject">
          <option value="">移入项目…</option>
          <option v-for="p in projectStore.items.value" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>
      <div class="m-list">
        <div v-for="item in filteredItems" :key="item.id"
          :class="['m-item', { active: item.id === selectedId && !selectMode, selected: selectMode && selectedIds.has(item.id) }]"
          @click="selectItem(item.id)"
        >
          <input v-if="selectMode" type="checkbox" :checked="selectedIds.has(item.id)" class="m-cb" @click.stop="toggleSelect(item.id)" />
          <div class="mi-body">
            <div class="mi-title"><span v-if="item.favorite" class="star">★</span>{{ item.title }}</div>
            <div class="mi-meta"><span class="type-tag">{{ { prompt: '提示词', snippet: '片段', template: '模板', constraint: '约束' }[item.type] || item.type }}</span><span class="spacer"></span><span class="cnt">{{ item.usageCount }}次</span></div>
          </div>
          <button v-if="!selectMode" class="mi-fav" @click.stop="toggleFavorite(item.id)" :title="item.favorite ? '取消收藏' : '收藏'">
            {{ item.favorite ? '★' : '☆' }}
          </button>
        </div>
      </div>
      <div class="m-foot"><button class="btn" @click="router.enterWizard('')">+ 新建</button></div>
    </div>

    <div v-if="selectedUnit" class="m-editor">
      <div class="tabs">
        <button :class="{ active: editTab === 'content' }" @click="editTab = 'content'">正文</button>
        <button :class="{ active: editTab === 'props' }" @click="editTab = 'props'">属性</button>
        <button :class="{ active: editTab === 'vars' }" @click="editTab = 'vars'">变量</button>
        <button :class="{ active: editTab === 'versions' }" @click="editTab = 'versions'">版本</button>
        <button :class="{ active: editTab === 'stats' }" @click="editTab = 'stats'">统计</button>
        <span class="ti">v{{ selectedUnit.version || 1 }}</span>
      </div>
      <div class="ec">
        <!-- 正文 -->
        <template v-if="editTab === 'content'">
          <div class="field"><label>标题</label><input v-model="editTitle" /></div>
          <div class="field"><label>正文</label><textarea v-model="editBody" class="body-editor" /></div>
        </template>

        <!-- 属性 -->
        <template v-else-if="editTab === 'props'">
          <div class="field">
            <label>类型</label>
            <div class="type-grid">
              <button v-for="t in [{v:'prompt' as PromptType,l:'提示词'},{v:'snippet' as PromptType,l:'片段'},{v:'template' as PromptType,l:'模板'},{v:'constraint' as PromptType,l:'约束'}]"
                :key="t.v" :class="['type-btn', { active: editType === t.v }]" @click="editType = t.v">{{ t.l }}</button>
            </div>
          </div>
          <div class="field">
            <label>归属项目</label>
            <select v-model="editProjectId" class="prop-select">
              <option value="">无项目（资产）</option>
              <option v-for="p in projectStore.items.value" :key="p.id" :value="p.id">{{ p.group }} / {{ p.name }}</option>
            </select>
          </div>
          <div class="field">
            <label>标签</label>
            <div v-if="editTags.length" class="tag-list">
              <span v-for="t in editTags" :key="t" class="tag-item">{{ t }} <button class="tag-rm" @click="removeTag(t)">×</button></span>
            </div>
            <div class="tag-input-row">
              <input v-model="tagInput" class="tag-input" placeholder="输入标签，回车添加" @keydown.enter.prevent="addTag" />
              <button class="btn btn-xs" @click="addTag">添加</button>
            </div>
          </div>
          <div class="field">
            <label>收藏</label>
            <button class="btn" @click="selectedUnit && toggleFavorite(selectedUnit.id)">
              {{ selectedUnit?.favorite ? '★ 已收藏' : '☆ 加入收藏' }}
            </button>
          </div>
        </template>

        <!-- 变量 -->
        <template v-else-if="editTab === 'vars'">
          <div class="vh"><h3>变量配置</h3><button class="btn" @click="addVar">+ 添加</button></div>
          <div v-if="editVars.length" class="vt">
            <div class="vr header"><div>变量名</div><div>默认值</div><div style="text-align:center">必填</div><div></div></div>
            <div v-for="(v, i) in editVars" :key="i" class="vr">
              <input v-model="v.name" /><input v-model="v.defaultValue" placeholder="默认…" />
              <div style="text-align:center"><input type="checkbox" v-model="v.required" /></div>
              <button class="db" @click="removeVar(i)">×</button>
            </div>
          </div>
          <div v-else class="empty">没有变量</div>
        </template>

        <!-- 版本 -->
        <template v-else-if="editTab === 'versions'">
          <!-- 当前版本 -->
          <div class="version-item current">
            <div class="vi-head">
              <span class="vi-ver">v{{ selectedUnit.version || 1 }}</span>
              <span class="vi-note">当前版本</span>
            </div>
            <div class="vi-body">{{ (selectedUnit.content || '').slice(0, 200) }}{{ (selectedUnit.content || '').length > 200 ? '…' : '' }}</div>
          </div>
          <!-- 历史快照 -->
          <div v-if="selectedUnit.snapshots && selectedUnit.snapshots.length" class="version-list">
            <div class="version-divider">历史版本（{{ selectedUnit.snapshots.length }}）</div>
            <div v-for="(snap, i) in [...selectedUnit.snapshots].reverse()" :key="i" class="version-item">
              <div class="vi-head">
                <span class="vi-ver">v{{ snap.version }}</span>
                <span class="vi-note">{{ snap.note }}</span>
                <span class="vi-time">{{ formatTime(snap.createdAt) }}</span>
              </div>
              <div class="vi-body">{{ snap.body.slice(0, 200) }}{{ snap.body.length > 200 ? '…' : '' }}</div>
              <div class="vi-actions">
                <button class="btn btn-xs" @click="viewingSnapshot = viewingSnapshot === i ? null : i">
                  {{ viewingSnapshot === i ? '收起' : '查看' }}
                </button>
                <button class="btn btn-xs" @click="restoreSnapshot(snap)">恢复此版本</button>
              </div>
              <div v-if="viewingSnapshot === i" class="vi-full">{{ snap.body }}</div>
            </div>
          </div>
          <div v-else class="empty">暂无历史版本。编辑正文并保存后会自动记录。</div>
        </template>

        <!-- 统计 -->
        <template v-else>
          <div class="stats-grid">
            <div class="sc"><div class="sv">{{ selectedUnit.usageCount }}</div><div class="sl">复制次数</div></div>
            <div class="sc"><div class="sv">v{{ selectedUnit.version || 1 }}</div><div class="sl">版本</div></div>
            <div class="sc"><div class="sv">{{ selectedUnit.variables?.length || 0 }}</div><div class="sl">变量</div></div>
          </div>
          <div class="stats-meta">
            <div class="sm-row"><span class="sm-label">创建时间</span><span>{{ formatTime(selectedUnit.createdAt) }}</span></div>
            <div class="sm-row"><span class="sm-label">更新时间</span><span>{{ formatTime(selectedUnit.updatedAt) }}</span></div>
            <div v-if="selectedUnit.lastUsedAt" class="sm-row"><span class="sm-label">最后使用</span><span>{{ formatTime(selectedUnit.lastUsedAt) }}</span></div>
          </div>
        </template>
      </div>
      <div class="ef">
        <button class="btn danger" @click="deleteUnit">删除</button>
        <span class="spacer"></span>
        <button class="btn primary" @click="saveEdit">保存</button>
      </div>
    </div>
    <div v-else class="m-empty">在左侧选择提示词</div>
  </div>
</template>

<style scoped>
.manage { width: 100%; flex: 1; min-height: 0; display: grid; grid-template-columns: 260px 1fr; grid-template-rows: 1fr; background: var(--pf-bg); overflow: hidden; }
.m-sidebar { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--pf-border); background: var(--pf-bg-elevated); }
.m-head { padding: 10px; border-bottom: 1px solid var(--pf-border); }
.m-head-actions { display: flex; gap: 4px; margin-top: 6px; }
.m-search { width: 100%; height: 32px; border: 1px solid var(--pf-border); border-radius: var(--pf-radius-sm); background: var(--pf-surface); padding: 0 10px; font-size: 12.5px; }
.m-search:focus { border-color: var(--pf-accent); outline: none; }
.btn-xs { height: 24px; padding: 0 8px; font-size: 11px; }
.btn-xs.active { background: var(--pf-accent-soft); color: var(--pf-accent); border-color: var(--pf-accent); }
.btn-xs.danger { color: var(--pf-danger); }
.m-filters { display: flex; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--pf-border); }
.m-filter-select { flex: 1; height: 28px; border: 1px solid var(--pf-border); border-radius: var(--pf-radius-xs); background: var(--pf-surface); font-size: 11.5px; padding: 0 6px; color: var(--pf-text); }
.m-filter-select:focus { border-color: var(--pf-accent); outline: none; }

.m-batch-bar { display: flex; align-items: center; gap: 6px; padding: 6px 10px; background: var(--pf-accent-soft); border-bottom: 1px solid var(--pf-border); font-size: 11px; }
.batch-info { font-weight: 600; color: var(--pf-accent); }
.batch-project { height: 22px; font-size: 11px; border: 1px solid var(--pf-border); border-radius: var(--pf-radius-xs); background: var(--pf-surface); padding: 0 4px; }

.m-list { flex: 1; min-height: 0; overflow-y: auto; padding: 6px; }
.m-item { display: flex; align-items: center; gap: 6px; padding: 8px; border-radius: var(--pf-radius-sm); cursor: pointer; border: 1px solid transparent; transition: all 0.12s; }
.m-item:hover { background: var(--pf-surface-hover); }
.m-item.active { background: var(--pf-accent-soft); border-color: var(--pf-accent); }
.m-item.selected { background: var(--pf-accent-soft); }
.m-cb { flex-shrink: 0; width: 14px; height: 14px; accent-color: var(--pf-accent); }
.mi-body { flex: 1; min-width: 0; }
.mi-title { font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.star { color: var(--pf-warning); font-size: 11px; }
.mi-meta { display: flex; gap: 6px; align-items: center; font-size: 11px; color: var(--pf-text-muted); margin-top: 2px; }
.type-tag { background: var(--pf-accent-soft); color: var(--pf-accent); padding: 0 5px; border-radius: 3px; font-size: 10px; font-weight: 600; }
.spacer { flex: 1; }
.cnt { color: var(--pf-accent); font-weight: 600; }
.mi-fav { flex-shrink: 0; background: none; border: none; font-size: 14px; cursor: pointer; color: var(--pf-text-faint); padding: 0 2px; line-height: 1; }
.mi-fav:hover { color: var(--pf-warning); }

.m-foot { padding: 8px; border-top: 1px solid var(--pf-border); }
.m-foot .btn { width: 100%; justify-content: center; }
.m-editor { display: flex; flex-direction: column; min-height: 0; overflow: hidden; background: var(--pf-surface); }
.tabs { height: 36px; display: flex; align-items: center; gap: 4px; padding: 0 16px; border-bottom: 1px solid var(--pf-border); background: var(--pf-bg-elevated); }
.tabs button { border: 0; background: none; color: var(--pf-text-muted); padding: 4px 12px; font-size: 13px; font-weight: 500; height: 36px; cursor: pointer; }
.tabs button.active { color: var(--pf-accent); font-weight: 600; }
.ti { margin-left: auto; font-size: 11px; color: var(--pf-text-faint); font-family: var(--pf-font-mono); }
.ec { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; }
.field { margin-bottom: 14px; }
.field label { display: block; font-size: 12px; font-weight: 600; color: var(--pf-text-secondary); margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.04em; }
.field input, .field textarea, .field select { width: 100%; border: 1px solid var(--pf-border); background: var(--pf-surface); border-radius: var(--pf-radius-sm); padding: 10px 14px; font-size: 13.5px; }
.field input:focus, .field textarea:focus { border-color: var(--pf-accent); outline: none; box-shadow: 0 0 0 3px var(--pf-accent-soft); }
.field select { height: 38px; padding: 0 10px; }
.body-editor { min-height: 250px; max-height: 50vh; resize: vertical; font-family: var(--pf-font-mono); line-height: 1.6; }

.type-grid { display: flex; gap: 6px; flex-wrap: wrap; }
.type-btn { padding: 6px 14px; border: 1px solid var(--pf-border); border-radius: var(--pf-radius-sm); background: var(--pf-surface); font-size: 12px; cursor: pointer; transition: all 0.12s; }
.type-btn:hover { border-color: var(--pf-accent); }
.type-btn.active { background: var(--pf-accent); color: #fff; border-color: var(--pf-accent); }
.tag-list { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.tag-item { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; background: var(--pf-accent-soft); color: var(--pf-accent); border-radius: var(--pf-radius-xs); font-size: 12px; font-weight: 500; }
.tag-rm { background: none; border: none; color: var(--pf-accent); cursor: pointer; font-size: 14px; padding: 0; line-height: 1; }
.tag-input-row { display: flex; gap: 6px; }
.tag-input { flex: 1; height: 30px; }

.vh { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.vh h3 { font-size: 14px; margin: 0; }
.vt { border: 1px solid var(--pf-border); border-radius: var(--pf-radius-sm); }
.vr { display: grid; grid-template-columns: 1fr 1fr 50px 30px; gap: 8px; align-items: center; padding: 6px 10px; border-bottom: 1px solid var(--pf-border); }
.vr.header { font-size: 11px; font-weight: 600; color: var(--pf-text-muted); background: var(--pf-bg-elevated); }
.vr input { height: 28px; padding: 2px 6px; font-size: 12px; border: 1px solid var(--pf-border); border-radius: var(--pf-radius-xs); }
.vr input:focus { border-color: var(--pf-accent); outline: none; }
.db { width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--pf-danger); color: var(--pf-danger); background: var(--pf-danger-soft); display: flex; align-items: center; justify-content: center; font-size: 14px; cursor: pointer; }
.db:hover { background: var(--pf-danger); color: #fff; }
.empty { padding: 24px; text-align: center; color: var(--pf-text-muted); }

.version-list { display: flex; flex-direction: column; gap: 10px; }
.version-item { border: 1px solid var(--pf-border); border-radius: var(--pf-radius-sm); padding: 12px; background: var(--pf-bg-elevated); }
.version-item.current { border-color: var(--pf-accent); background: var(--pf-accent-soft); }
.version-divider { font-size: 11px; font-weight: 700; color: var(--pf-text-faint); text-transform: uppercase; letter-spacing: 0.06em; padding: 8px 0 2px; }
.vi-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.vi-ver { font-family: var(--pf-font-mono); font-size: 12px; font-weight: 700; color: var(--pf-accent); background: var(--pf-accent-soft); padding: 2px 8px; border-radius: var(--pf-radius-xs); }
.vi-note { font-size: 12px; color: var(--pf-text-secondary); flex: 1; }
.vi-time { font-size: 11px; color: var(--pf-text-faint); font-family: var(--pf-font-mono); }
.vi-body { font-size: 12px; color: var(--pf-text-muted); font-family: var(--pf-font-mono); line-height: 1.5; white-space: pre-wrap; word-break: break-all; background: var(--pf-surface); padding: 8px; border-radius: var(--pf-radius-xs); margin-bottom: 8px; max-height: 80px; overflow: hidden; }
.vi-full { font-size: 12px; color: var(--pf-text); font-family: var(--pf-font-mono); line-height: 1.6; white-space: pre-wrap; word-break: break-all; background: var(--pf-surface); padding: 12px; border-radius: var(--pf-radius-xs); border: 1px solid var(--pf-border); margin-top: 8px; }
.vi-actions { display: flex; gap: 6px; }

.stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }
.sc { border: 1px solid var(--pf-border); border-radius: var(--pf-radius-sm); padding: 14px; text-align: center; background: var(--pf-bg-elevated); }
.sv { font-size: 20px; font-weight: 700; color: var(--pf-accent); }
.sl { font-size: 11px; color: var(--pf-text-faint); margin-top: 4px; }
.stats-meta { display: flex; flex-direction: column; gap: 0; }
.sm-row { display: flex; justify-content: space-between; font-size: 12px; color: var(--pf-text-secondary); padding: 8px 0; border-bottom: 1px solid var(--pf-border); }
.sm-label { font-weight: 600; color: var(--pf-text-muted); }

.ef { flex-shrink: 0; height: 48px; border-top: 1px solid var(--pf-border); padding: 0 16px; display: flex; align-items: center; gap: 8px; background: var(--pf-bg-elevated); }
.m-empty { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--pf-text-faint); font-size: 13px; }
</style>
