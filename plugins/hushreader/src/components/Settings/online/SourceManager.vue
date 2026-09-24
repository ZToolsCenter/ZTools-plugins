<template>
  <div class="source-manager">
    <!-- 统计与全局操作 -->
    <div class="stats-bar">
      <div class="stats">
        <span class="stat"><b>{{ totalCount }}</b> 个书源</span>
        <span class="stat-sep">·</span>
        <span class="stat"><b>{{ enabledCount }}</b> 已启用</span>
        <span class="stat-sep">·</span>
        <span class="stat"><b>{{ onlineStore.groups.length }}</b> 个分组</span>
        <span v-if="loginNeedCount > 0" class="stat-sep">·</span>
        <span v-if="loginNeedCount > 0" class="stat login-need"><b>{{ loginNeedCount }}</b> 需登录</span>
      </div>
      <div class="stats-actions">
        <button class="mini-btn" :disabled="totalCount === 0" @click="setAllEnabled(true)">全部启用</button>
        <button class="mini-btn" :disabled="totalCount === 0" @click="setAllEnabled(false)">全部停用</button>
      </div>
    </div>

    <!-- 导入 / 导出 -->
    <div class="toolbar">
      <button class="btn-secondary" @click="importFromFile">从文件导入</button>
      <button class="btn-secondary" @click="showUrlImport = !showUrlImport; importUrl = ''">从链接导入</button>
      <button class="btn-secondary" @click="showTextImport = !showTextImport; importText = ''">粘贴文本导入</button>
      <button class="btn-secondary" :disabled="totalCount === 0" @click="exportSources">导出</button>
      <div class="toolbar-grow"></div>
      <span class="import-to">导入到</span>
      <select v-model="importTargetGroupId" class="select import-to-select">
        <option v-if="onlineStore.groups.length === 0" value="">默认分组</option>
        <option value="new">＋ 新建分组</option>
        <option v-for="g in onlineStore.groups" :key="g.id" :value="g.id">{{ g.name }}</option>
      </select>
      <input v-if="importTargetGroupId === 'new'" v-model="newGroupName" class="text-input import-to-name"
        placeholder="新分组名称" />
    </div>

    <div v-if="showUrlImport" class="import-box">
      <div class="url-import-row">
        <input v-model="importUrl" class="text-input url-import-input" placeholder="https://www.luoxx.top/book_source.txt"
          @keydown.enter="importFromUrl" />
        <button class="btn-primary" :disabled="!importUrl.trim() || importingFromUrl" @click="importFromUrl">
          <span v-if="importingFromUrl" class="spinner" style="width:13px;height:13px;border-width:1.5px;margin-right:4px"></span>
          {{ importingFromUrl ? '导入中…' : '导入' }}
        </button>
        <button class="btn-secondary" @click="showUrlImport = false; importUrl = ''">取消</button>
      </div>
    </div>

    <div v-if="showTextImport" class="import-box">
      <textarea v-model="importText" class="import-textarea" placeholder="粘贴书源 JSON 文本…"></textarea>
      <div class="import-actions">
        <button class="btn-secondary" @click="showTextImport = false; importText = ''">取消</button>
        <button class="btn-primary" :disabled="!importText.trim()" @click="confirmTextImport">导入</button>
      </div>
    </div>

    <!-- 分组标签栏 -->
    <div class="group-tabs">
      <button class="group-tab" :class="{ active: selectedGroupId === ALL }" @click="selectedGroupId = ALL">
        全部
        <span class="group-tab-count">{{ totalCount }}</span>
      </button>
      <button v-for="g in onlineStore.groups" :key="g.id" class="group-tab"
        :class="{ active: selectedGroupId === g.id }" @click="selectedGroupId = g.id">
        {{ g.name }}
        <span class="group-tab-count">{{ g.sources.length }}</span>
      </button>
      <button class="group-tab group-tab-add" title="新建分组" @click="createGroup">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>

    <!-- 当前分组操作 -->
    <div v-if="selectedGroup && selectedGroupId !== ALL" class="group-ops">
      <span class="group-ops-name">{{ selectedGroup.name }}</span>
      <button class="mini-btn" :disabled="selectedGroup.sources.length === 0" @click="toggleGroupEnabled(true)">组内全部启用</button>
      <button class="mini-btn" :disabled="selectedGroup.sources.length === 0" @click="toggleGroupEnabled(false)">组内全部停用</button>
      <button class="mini-btn" @click="renameCurrentGroup">重命名</button>
      <button class="mini-btn mini-btn-danger" :disabled="onlineStore.groups.length <= 1" @click="removeCurrentGroup">删除分组</button>
    </div>

    <!-- 书源列表 -->
    <div v-if="visibleEntries.length === 0" class="empty-hint">
      {{ onlineStore.groups.length === 0 ? '尚未添加书源，可先在上方导入' : '该分组暂无书源' }}
    </div>
    <div v-else class="source-list">
      <SourceItem
        v-for="entry in visibleEntries"
        :key="entry.groupId + '-' + entry.index"
        :source="entry.source"
        :group-name="selectedGroupId === ALL ? entry.groupName : undefined"
        :group-id="entry.groupId"
        :index="entry.index"
        :source-type-label="sourceTypeLabel(entry.source)"
        @toggle="toggleSource(entry.groupId, entry.index)"
        @edit="openEdit(entry)"
        @login="openLogin(entry)"
        @debug="openDebug(entry)"
        @delete="removeSource(entry)"
      />
    </div>

    <p class="hint-bottom">支持开源阅读（Legado）新格式（ruleSearch/ruleToc/ruleContent/ruleBookInfo）与「阅读 2.x」旧格式书源；可导入社区分享的 .json 书源文件、粘贴文本或从链接导入。需登录的书源可在书源行上点击「登录」完成 Cookie 获取；搜索无结果时点击书源行的「调试」按钮，可查看请求与规则解析的完整过程。</p>

    <!-- 弹窗 -->
    <SourceEditorModal
      v-if="editing"
      :source="editing.source"
      :group-id="editing.groupId"
      :groups="onlineStore.groups"
      @save="saveSource"
      @close="editing = null"
    />
    <SourceLoginModal
      v-if="loginFor"
      :source="loginFor.source"
      :group-id="loginFor.groupId"
      :index="loginFor.index"
      @close="loginFor = null"
    />
    <SourceDebugModal
      v-if="debugFor"
      :source="debugFor.source"
      :group-id="debugFor.groupId"
      :index="debugFor.index"
      @close="debugFor = null"
    />

    <!-- 标准弹窗：确认 / 输入 -->
    <PromptDialog
      v-if="showCreateGroup"
      title="新建分组"
      label="分组名称"
      placeholder="例如：小说站"
      confirm-text="创建"
      @confirm="confirmCreateGroup"
      @cancel="showCreateGroup = false"
    />
    <PromptDialog
      v-if="showRenameGroup"
      title="重命名分组"
      label="新名称"
      :initial="selectedGroup?.name"
      confirm-text="重命名"
      @confirm="confirmRenameGroup"
      @cancel="showRenameGroup = false"
    />
    <ConfirmDialog
      v-if="showRemoveGroup"
      title="删除分组"
      :message="`确定删除分组「${selectedGroup?.name || ''}」及其下 ${selectedGroup?.sources.length || 0} 个书源吗？此操作不可撤销。`"
      confirm-text="删除"
      @confirm="confirmRemoveGroup"
      @cancel="showRemoveGroup = false"
    />
    <ConfirmDialog
      v-if="showRemoveSource"
      title="删除书源"
      :message="`确定删除书源「${pendingRemoveSource ? sourceDisplayName(pendingRemoveSource.source) : ''}」吗？此操作不可撤销。`"
      confirm-text="删除"
      @confirm="confirmRemoveSource"
      @cancel="showRemoveSource = false"
    />

    <Toast :message="toastMsg" :type="toastType" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useOnlineStore } from '../../../stores/online'
import { sourceDisplayName, type BookSource } from '../../../utils/onlineBook'
import SourceItem from './SourceItem.vue'
import SourceEditorModal from './SourceEditorModal.vue'
import SourceLoginModal from './SourceLoginModal.vue'
import SourceDebugModal from './SourceDebugModal.vue'
import Toast from '../../Bookshelf/Toast.vue'
import ConfirmDialog from '../../common/ConfirmDialog.vue'
import PromptDialog from '../../common/PromptDialog.vue'

const onlineStore = useOnlineStore()

const toastMsg = ref('')
const toastType = ref<'info' | 'success' | 'error'>('info')
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(msg: string, type: 'info' | 'success' | 'error' = 'info') {
  if (toastTimer) clearTimeout(toastTimer)
  toastMsg.value = msg
  toastType.value = type
  toastTimer = setTimeout(() => { toastMsg.value = '' }, 2500)
}

onMounted(() => {
  onlineStore.load()
})

// ---------- 分组筛选 ----------

const ALL = '__all__'
const selectedGroupId = ref<string>(ALL)

const selectedGroup = computed(() =>
  onlineStore.groups.find(g => g.id === selectedGroupId.value)
)

/** 当前视图中展示的书源条目（全部 / 指定分组） */
const visibleEntries = computed(() => {
  const entries: Array<{ groupId: string; index: number; source: BookSource; groupName: string }> = []
  for (const g of onlineStore.groups) {
    if (selectedGroupId.value !== ALL && g.id !== selectedGroupId.value) continue
    g.sources.forEach((source, index) => {
      entries.push({ groupId: g.id, index, source, groupName: g.name })
    })
  }
  return entries
})

const totalCount = computed(() => onlineStore.groups.reduce((n, g) => n + g.sources.length, 0))
const enabledCount = computed(() =>
  onlineStore.groups.reduce((n, g) => n + g.sources.filter(s => s.enabled !== false).length, 0)
)
const loginNeedCount = computed(() =>
  onlineStore.groups.reduce((n, g) => n + g.sources.filter(s => (s.loginUrl || '').trim() && s.enabled !== false).length, 0)
)

function setAllEnabled(enabled: boolean) {
  for (const g of onlineStore.groups) {
    for (const s of g.sources) s.enabled = enabled
  }
  onlineStore.save()
  showToast(enabled ? '已启用全部书源' : '已停用全部书源', 'info')
}

// ---------- 分组操作 ----------

const showCreateGroup = ref(false)
const showRenameGroup = ref(false)
const showRemoveGroup = ref(false)

function createGroup() {
  showCreateGroup.value = true
}

function confirmCreateGroup(name: string) {
  showCreateGroup.value = false
  const id = onlineStore.createGroup(name)
  selectedGroupId.value = id
  showToast('分组已创建', 'success')
}

function renameCurrentGroup() {
  if (!selectedGroup.value) return
  showRenameGroup.value = true
}

function confirmRenameGroup(name: string) {
  showRenameGroup.value = false
  const g = selectedGroup.value
  if (!g || name === g.name) return
  onlineStore.renameGroup(g.id, name)
  showToast('分组已重命名', 'success')
}

function removeCurrentGroup() {
  if (!selectedGroup.value) return
  showRemoveGroup.value = true
}

function confirmRemoveGroup() {
  showRemoveGroup.value = false
  const g = selectedGroup.value
  if (!g) return
  onlineStore.removeGroup(g.id)
  selectedGroupId.value = ALL
  showToast('分组已删除', 'info')
}

function toggleGroupEnabled(enabled: boolean) {
  const g = selectedGroup.value
  if (!g) return
  onlineStore.setGroupEnabled(g.id, enabled)
  showToast(enabled ? `已启用「${g.name}」全部书源` : `已停用「${g.name}」全部书源`, 'info')
}

// ---------- 书源操作 ----------

function toggleSource(groupId: string, index: number) {
  onlineStore.toggleSource(groupId, index)
  const group = onlineStore.groups.find(g => g.id === groupId)
  const source = group?.sources?.[index]
  if (source) {
    showToast(source.enabled === false ? `已停用「${sourceDisplayName(source)}」` : `已启用「${sourceDisplayName(source)}」`, 'info')
  }
}

const showRemoveSource = ref(false)
const pendingRemoveSource = ref<EditingTarget | null>(null)

function removeSource(entry: EditingTarget) {
  pendingRemoveSource.value = { ...entry, source: JSON.parse(JSON.stringify(entry.source)) }
  showRemoveSource.value = true
}

function confirmRemoveSource() {
  showRemoveSource.value = false
  const entry = pendingRemoveSource.value
  if (!entry) return
  onlineStore.removeSource(entry.groupId, entry.index)
  showToast('书源已删除', 'info')
}

// ---------- 编辑 / 登录弹窗 ----------

interface EditingTarget {
  groupId: string
  index: number
  source: BookSource
}

const editing = ref<EditingTarget | null>(null)
const loginFor = ref<EditingTarget | null>(null)
const debugFor = ref<EditingTarget | null>(null)

function openEdit(entry: EditingTarget) {
  editing.value = { ...entry, source: JSON.parse(JSON.stringify(entry.source)) }
}

function openLogin(entry: EditingTarget) {
  loginFor.value = { ...entry, source: JSON.parse(JSON.stringify(entry.source)) }
}

function openDebug(entry: EditingTarget) {
  debugFor.value = { ...entry, source: JSON.parse(JSON.stringify(entry.source)) }
}

function saveSource(patch: Partial<BookSource>, toGroupId?: string) {
  const target = editing.value
  if (!target) return
  let groupId = target.groupId
  let index = target.index
  if (toGroupId && toGroupId !== target.groupId) {
    if (onlineStore.moveSource(groupId, index, toGroupId)) {
      const targetGroup = onlineStore.groups.find(g => g.id === toGroupId)
      if (targetGroup) {
        groupId = toGroupId
        index = targetGroup.sources.length - 1
      }
    } else {
      showToast('移动分组失败（目标分组已存在相同书源）', 'error')
    }
  }
  onlineStore.updateSource(groupId, index, patch)
  editing.value = null
  selectedGroupId.value = groupId
  showToast('书源已保存', 'success')
}

// ---------- 导入 / 导出 ----------

const showUrlImport = ref(false)
const showTextImport = ref(false)
const importUrl = ref('')
const importText = ref('')
const importingFromUrl = ref(false)
/** 导入目标分组：'new' 新建分组，'' 默认分组（store 自动落到第一个分组），否则为已有分组 id */
const importTargetGroupId = ref<string>('')
const newGroupName = ref('')

// 有分组时默认选中第一个分组；分组被删光/删除后自动回退，避免选中不存在的分组
watch(() => onlineStore.groups.map(g => g.id).join(','), () => {
  if (importTargetGroupId.value === 'new') return
  const ids = onlineStore.groups.map(g => g.id)
  if (importTargetGroupId.value === '' || !ids.includes(importTargetGroupId.value)) {
    importTargetGroupId.value = ids.length ? ids[0] : ''
  }
}, { immediate: true })

/** 把书源文本导入到当前选定的目标分组，返回错误信息（成功返回 null） */
function performImport(text: string): string | null {
  const isNew = importTargetGroupId.value === 'new'
  const groupId = isNew ? onlineStore.createGroup(newGroupName.value) : importTargetGroupId.value
  const error = onlineStore.importSourcesText(text, groupId)
  if (isNew) {
    const created = onlineStore.groups.find(g => g.id === groupId)
    if (created && created.sources.length === 0) {
      onlineStore.removeGroup(groupId)
      importTargetGroupId.value = onlineStore.groups[0]?.id || ''
    } else if (created) {
      selectedGroupId.value = groupId
      importTargetGroupId.value = groupId
    }
    newGroupName.value = ''
  }
  return error
}

async function importFromFile() {
  const ztools = (window as any).ztools
  if (!ztools?.showOpenDialog) {
    showToast('当前环境不支持文件选择', 'error')
    return
  }
  const paths = ztools.showOpenDialog({
    title: '导入书源',
    filters: [{ name: '书源 JSON', extensions: ['json', 'txt'] }],
    properties: ['openFile']
  })
  if (!paths?.length) return
  try {
    const text = window.services.readFileFromPath(paths[0])
    const error = performImport(text)
    if (error) showToast(error, 'error')
    else showToast('书源导入成功', 'success')
  } catch (e: any) {
    showToast(`导入失败：${e?.message || e}`, 'error')
  }
}

function confirmTextImport() {
  const error = performImport(importText.value)
  if (error) showToast(error, 'error')
  else showToast('书源导入成功', 'success')
  importText.value = ''
  showTextImport.value = false
}

async function importFromUrl() {
  const raw = importUrl.value.trim()
  if (!raw) return
  if (!/^https?:\/\//i.test(raw)) {
    showToast('请输入 http(s):// 开头的书源文件链接', 'error')
    return
  }
  importingFromUrl.value = true
  try {
    const services = (window as any).services
    if (!services?.httpGetResponse && !services?.httpGetText) {
      showToast('当前环境不支持网络请求', 'error')
      return
    }
    console.log(`[hushreader:import] 链接导入：${raw}`)
    const options = { timeout: 60000, headers: { Accept: 'application/json, text/plain, */*' } }
    let text = ''
    let status = 200
    let contentType = ''
    if (services.httpGetResponse) {
      const res = await services.httpGetResponse(raw, options)
      status = res.status
      contentType = String(res.headers?.['content-type'] || '')
      text = res.text
    } else {
      text = await services.httpGetText(raw, options)
    }
    console.log(`[hushreader:import] 响应：HTTP ${status}，Content-Type=${contentType}，长度=${text.length}`)
    const trimmed = text.trim()
    if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) {
      const preview = trimmed.replace(/\s+/g, ' ').slice(0, 160)
      console.warn(`[hushreader:import] 返回内容不是 JSON（HTTP ${status}，${contentType || '未知类型'}），内容开头：${preview}`)
      showToast(
        `链接返回的不是 JSON 文本（HTTP ${status}，${contentType || '未知类型'}）。返回内容开头：「${preview}」` +
        (preview.includes('<') ? '—— 可能是跳转页/反爬页，请用浏览器打开链接确认，复制其中的 JSON 后用「粘贴文本导入」' : ''),
        'error'
      )
      return
    }
    const error = performImport(text)
    if (error) showToast(error, 'error')
    else {
      showToast('书源导入成功', 'success')
      importUrl.value = ''
      showUrlImport.value = false
    }
  } catch (e: any) {
    console.warn('[hushreader:import] 链接导入失败', e)
    showToast(`导入失败：${e?.message || e}`, 'error')
  } finally {
    importingFromUrl.value = false
  }
}

function exportSources() {
  const text = onlineStore.exportSourcesText()
  const ztools = (window as any).ztools
  if (ztools?.showSaveDialog) {
    const filePath = ztools.showSaveDialog({
      title: '导出书源',
      defaultPath: 'hushreader-book-sources.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (filePath) window.services.writeFileToPath(filePath, text)
    showToast('书源已导出', 'success')
    return
  }
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'hushreader-book-sources.json'
  a.click()
  URL.revokeObjectURL(url)
  showToast('书源已导出', 'success')
}

function sourceTypeLabel(s: BookSource): string {
  if (s.ruleSearch) return '阅读'
  if (String(s.source_type ?? '1') === '2') return 'API'
  return 'HTML'
}
</script>

<style scoped>
.source-manager {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ---------- 统计条 ---------- */
.stats-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-md);
  background: var(--c-surface);
}

.stats {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--c-ink-secondary);
}

.stat b {
  color: var(--c-ink);
  font-weight: 700;
}

.stat.login-need b {
  color: var(--c-warning);
}

.stat-sep {
  color: var(--c-border-strong);
}

.stats-actions {
  display: flex;
  gap: 6px;
}

.mini-btn {
  padding: 4px 10px;
  font-size: 11px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--c-border);
  background: var(--c-surface-sunken);
  color: var(--c-ink-secondary);
  transition: all 0.12s var(--ease-out);
}

.mini-btn:hover:not(:disabled) {
  color: var(--c-ink);
  border-color: var(--c-border-strong);
}

.mini-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.mini-btn-danger:hover:not(:disabled) {
  background: var(--c-danger-soft);
  color: var(--c-danger);
  border-color: var(--c-danger);
}

/* ---------- 工具栏 ---------- */
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.toolbar-grow {
  flex: 1;
}

.import-to {
  font-size: 12px;
  color: var(--c-ink-secondary);
}

.import-to-select {
  max-width: 160px;
}

.import-to-name {
  width: 140px;
}

.btn-primary,
.btn-secondary {
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  transition: all 0.15s var(--ease-out);
}

.btn-primary {
  background: var(--c-accent);
  color: var(--c-ink-inverse);
}

.btn-primary:hover {
  background: var(--c-accent-hover);
}

.btn-primary:disabled {
  opacity: 0.5;
}

.btn-secondary {
  background: var(--c-surface-sunken);
  color: var(--c-ink);
  border: 1px solid var(--c-border);
}

.btn-secondary:hover:not(:disabled) {
  border-color: var(--c-border-strong);
  background: var(--c-border);
}

.btn-secondary:disabled {
  opacity: 0.5;
}

.select,
.text-input {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  color: var(--c-ink);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  font-size: 12px;
}

.select:focus,
.text-input:focus {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px var(--c-accent-soft);
  outline: none;
}

/* ---------- 导入面板 ---------- */
.import-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px dashed var(--c-border-strong);
  border-radius: var(--radius-md);
  background: var(--c-surface-sunken);
}

.url-import-row {
  display: flex;
  gap: 8px;
}

.url-import-input {
  flex: 1;
  min-width: 0;
}

.import-textarea {
  width: 100%;
  min-height: 110px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  color: var(--c-ink);
  padding: 8px 10px;
  font-size: 12px;
  font-family: var(--font-mono);
  resize: vertical;
}

.import-textarea:focus {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px var(--c-accent-soft);
  outline: none;
}

.import-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

/* ---------- 分组标签栏 ---------- */
.group-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding: 2px 0;
}

.group-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--radius-full);
  font-size: 12px;
  font-weight: 600;
  color: var(--c-ink-secondary);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  transition: all 0.15s var(--ease-out);
}

.group-tab:hover {
  border-color: var(--c-border-strong);
  color: var(--c-ink);
}

.group-tab.active {
  background: var(--c-accent);
  border-color: var(--c-accent);
  color: var(--c-ink-inverse);
}

.group-tab-count {
  font-size: 10px;
  font-weight: 700;
  padding: 0 6px;
  border-radius: var(--radius-full);
  background: var(--c-surface-sunken);
  color: var(--c-ink-tertiary);
}

.group-tab.active .group-tab-count {
  background: rgba(255, 255, 255, 0.2);
  color: inherit;
}

.group-tab-add {
  padding: 6px 10px;
  color: var(--c-ink-tertiary);
}

/* ---------- 分组操作 ---------- */
.group-ops {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--radius-md);
  background: var(--c-surface-sunken);
}

.group-ops-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-ink);
  margin-right: auto;
}

/* ---------- 书源列表 ---------- */
.source-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.empty-hint {
  padding: 26px 0;
  text-align: center;
  color: var(--c-ink-tertiary);
  font-size: 13px;
}

.hint-bottom {
  margin: 2px 0 0;
  font-size: 11px;
  line-height: 1.7;
  color: var(--c-ink-tertiary);
}
</style>
