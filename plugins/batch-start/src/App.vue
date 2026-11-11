<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppList, { type CategoryFilter } from './components/AppList.vue'
import CategorySidebar from './components/CategorySidebar.vue'
import GroupPanel, { type GroupDraft } from './components/GroupPanel.vue'
import TopBar from './components/TopBar.vue'
import { useHostTheme } from './composables/useHostTheme'
import type { AppDoc, CategoryDoc, GroupDoc, LaunchResult, SettingsDoc } from './types'

useHostTheme()

const apps = ref<AppDoc[]>([])
const categories = ref<CategoryDoc[]>([])
const groups = ref<GroupDoc[]>([])
const settings = ref<SettingsDoc | null>(null)

const categoryFilter = ref<CategoryFilter>('all')
/** 左侧栏选中的分类，仅用于 ← 加入，不影响中间筛选 */
const selectedCategoryId = ref<string | null>(null)
const selectedGroupId = ref<string | null>(null)
const selectedAppIds = ref<string[]>([])
const searchQuery = ref('')

const draft = ref<GroupDraft | null>(null)
const saveError = ref<string | null>(null)
const busy = ref(false)
const loadError = ref<string | null>(null)

/** Defaults match design: category collapsed, group expanded */
const categoryCollapsed = ref(true)
const groupCollapsed = ref(false)

const api = () => window.batchStart

const lastScanAt = computed(() => settings.value?.lastScanAt ?? null)
const hasApps = computed(() => apps.value.length > 0)
const hasGroups = computed(() => groups.value.length > 0)
const canTrialRun = computed(() => selectedGroupId.value != null || !!draft.value?.id)

/** Overlay unsaved draft membership so list tags stay in sync */
const displayGroups = computed<GroupDoc[]>(() => {
  const list = groups.value.map((g) => ({ ...g, appIds: [...g.appIds] }))
  const d = draft.value
  if (!d) return list
  if (d.id) {
    const idx = list.findIndex((g) => g._id === d.id)
    if (idx >= 0) {
      list[idx] = { ...list[idx], name: d.name, appIds: [...d.appIds] }
    }
    return list
  }
  list.push({
    _id: 'group:__draft__',
    name: d.name.trim() || '新启动组',
    cmds: [],
    appIds: [...d.appIds],
    order: Number.MAX_SAFE_INTEGER,
    featureSynced: false,
  })
  return list
})

async function loadAll() {
  loadError.value = null
  try {
    if (!window.batchStart) {
      loadError.value = 'preload 未注入 window.batchStart，请确认安装的是 src-ztools 目录且已重新构建'
      return
    }
    const [a, c, g, s] = await Promise.all([
      api().listApps(),
      api().listCategories(),
      api().listGroups(),
      api().getSettings(),
    ])
    apps.value = a
    categories.value = c
    groups.value = g
    settings.value = s
    categoryCollapsed.value = s.ui?.categoryCollapsed ?? true
    groupCollapsed.value = s.ui?.groupCollapsed ?? false
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err)
  }
}

async function persistUiPrefs(patch: { categoryCollapsed?: boolean; groupCollapsed?: boolean }) {
  try {
    const next = await api().patchUiPrefs(patch)
    settings.value = next
    categoryCollapsed.value = next.ui?.categoryCollapsed ?? categoryCollapsed.value
    groupCollapsed.value = next.ui?.groupCollapsed ?? groupCollapsed.value
  } catch {
    // UI prefs are best-effort
  }
}

function toggleCategoryCollapsed() {
  const next = !categoryCollapsed.value
  categoryCollapsed.value = next
  void persistUiPrefs({ categoryCollapsed: next })
}

function toggleGroupCollapsed() {
  const next = !groupCollapsed.value
  groupCollapsed.value = next
  void persistUiPrefs({ groupCollapsed: next })
}

function syncDraftFromGroup(group: GroupDoc) {
  draft.value = {
    id: group._id,
    name: group.name,
    cmdsText: group.cmds.join(', '),
    appIds: [...group.appIds],
    order: group.order,
    featureSynced: group.featureSynced,
  }
  selectedGroupId.value = group._id
  saveError.value = null
}

function selectGroup(id: string) {
  const group = groups.value.find((g) => g._id === id)
  if (!group) return
  syncDraftFromGroup(group)
}

function createGroup() {
  selectedGroupId.value = null
  draft.value = {
    name: '',
    cmdsText: '',
    appIds: [],
    order: groups.value.length,
  }
  saveError.value = null
}

function parseCmds(name: string, cmdsText: string): string[] {
  const parts = cmdsText
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length === 0) {
    const n = name.trim()
    return n ? [n] : []
  }
  return parts
}

async function withBusy<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (busy.value) return undefined
  busy.value = true
  try {
    return await fn()
  } finally {
    busy.value = false
  }
}

async function onScan() {
  await withBusy(async () => {
    await api().runScan()
    await loadAll()
    const cmdCount = apps.value.filter(
      (a) => a.source === 'ztools' || a.source === 'plugin',
    ).length
    const message =
      cmdCount > 0
        ? `扫描完成：共 ${apps.value.length} 个应用（含 ${cmdCount} 条 ZTools 指令）`
        : `扫描完成：共 ${apps.value.length} 个应用`
    const showToast = window.ztools?.showToast
    if (typeof showToast === 'function') {
      void Promise.resolve(showToast(message))
    }
  })
}

async function onAddDir() {
  await withBusy(async () => {
    const next = await api().addCustomScanDir()
    if (next) settings.value = next
  })
}

function showTrialRunFeedback(result: LaunchResult) {
  const message = `试跑完成：成功 ${result.success} / 失败 ${result.failed}`
  const showToast = window.ztools?.showToast
  if (typeof showToast === 'function') {
    void Promise.resolve(showToast(message))
    return
  }
  window.alert(message)
}

async function onTrialRun() {
  const id = draft.value?.id ?? selectedGroupId.value
  if (!id) return
  await withBusy(async () => {
    const result = await api().launchGroup(id)
    showTrialRunFeedback(result)
  })
}

function showLaunchFeedback(result: LaunchResult, appName?: string) {
  const prefix = appName ? `「${appName}」` : ''
  const message =
    result.failed === 0
      ? `${prefix}已启动`
      : `${prefix}启动失败：${result.errors[0]?.error || '未知错误'}`
  const showToast = window.ztools?.showToast
  if (typeof showToast === 'function') {
    void Promise.resolve(showToast(message))
    return
  }
  if (result.failed > 0) window.alert(message)
}

async function onLaunchApp(appId: string) {
  const app = apps.value.find((a) => a._id === appId)
  await withBusy(async () => {
    const result = await api().launchApp(appId)
    showLaunchFeedback(result, app?.name)
  })
}

async function onCreateCategory(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return
  await withBusy(async () => {
    const created = await api().createCategory(trimmed)
    await loadAll()
    selectedCategoryId.value = created._id
  })
}

async function onRenameCategory(id: string, name: string) {
  const trimmed = name.trim()
  if (!trimmed) return
  await withBusy(async () => {
    await api().renameCategory(id, trimmed)
    await loadAll()
  })
}

async function onDeleteCategory(id: string) {
  if (!window.confirm('删除该分类？其下应用将回到未分类。')) return
  await withBusy(async () => {
    await api().deleteCategory(id)
    if (categoryFilter.value === id) categoryFilter.value = 'all'
    if (selectedCategoryId.value === id) selectedCategoryId.value = null
    await loadAll()
  })
}

function toggleSelect(appId: string) {
  const set = new Set(selectedAppIds.value)
  if (set.has(appId)) set.delete(appId)
  else set.add(appId)
  selectedAppIds.value = [...set]
}

function addSelectedToGroup() {
  if (!draft.value) createGroup()
  const current = draft.value!
  const set = new Set(current.appIds)
  for (const id of selectedAppIds.value) set.add(id)
  draft.value = { ...current, appIds: [...set] }
}

const canAddToGroup = computed(() => draft.value != null)

function addAppToGroup(appId: string) {
  if (!draft.value) return
  const current = draft.value
  if (current.appIds.includes(appId)) return
  draft.value = { ...current, appIds: [...current.appIds, appId] }
}

const canAddToCategory = computed(() => selectedCategoryId.value != null)

const selectedCategoryName = computed(() => {
  const id = selectedCategoryId.value
  if (!id) return ''
  return categories.value.find((c) => c._id === id)?.name ?? '分类'
})

async function addAppToCategory(appId: string) {
  const categoryId = selectedCategoryId.value
  if (!categoryId) return
  await withBusy(async () => {
    await api().assignCategory(appId, categoryId)
    await loadAll()
  })
}

async function removeAppFromCategory(appId: string, categoryId: string) {
  await withBusy(async () => {
    await api().removeCategory(appId, categoryId)
    await loadAll()
  })
}

function patchDraftMembership(appId: string, groupId: string) {
  const d = draft.value
  if (!d) return
  const isTarget =
    (d.id != null && d.id === groupId) || (!d.id && groupId === 'group:__draft__')
  if (!isTarget) return
  draft.value = {
    ...d,
    appIds: d.appIds.filter((id) => id !== appId),
  }
}

async function removeAppFromGroup(appId: string, groupId: string) {
  patchDraftMembership(appId, groupId)
  if (groupId === 'group:__draft__') return

  const group = groups.value.find((g) => g._id === groupId)
  if (!group) return

  const nextIds = group.appIds.filter((id) => id !== appId)
  await withBusy(async () => {
    if (nextIds.length === 0) {
      await api().deleteGroup(groupId)
      if (draft.value?.id === groupId) {
        draft.value = null
        selectedGroupId.value = null
      }
    } else {
      const saved = await api().saveGroup(
        {
          name: group.name,
          cmds: [...group.cmds],
          appIds: nextIds,
          order: group.order,
        },
        groupId,
      )
      if (draft.value?.id === groupId) syncDraftFromGroup(saved)
    }
    await loadAll()
  })
}

function removeMember(appId: string) {
  if (!draft.value) return
  draft.value = {
    ...draft.value,
    appIds: draft.value.appIds.filter((id) => id !== appId),
  }
}

async function onSaveGroup() {
  if (!draft.value) return
  saveError.value = null
  const name = draft.value.name.trim()
  const cmds = parseCmds(name, draft.value.cmdsText)
  await withBusy(async () => {
    try {
      const saved = await api().saveGroup(
        {
          name,
          cmds,
          appIds: [...draft.value!.appIds],
          order: draft.value!.order,
        },
        draft.value!.id,
      )
      await loadAll()
      syncDraftFromGroup(saved)
    } catch (err) {
      saveError.value = err instanceof Error ? err.message : String(err)
    }
  })
}

async function onDeleteGroup() {
  if (!draft.value?.id) return
  if (!window.confirm(`删除启动组「${draft.value.name}」？`)) return
  const id = draft.value.id
  await withBusy(async () => {
    await api().deleteGroup(id)
    draft.value = null
    selectedGroupId.value = null
    saveError.value = null
    await loadAll()
  })
}

async function onRetrySync() {
  if (!draft.value?.id) return
  await withBusy(async () => {
    const updated = await api().retrySyncGroup(draft.value!.id!)
    await loadAll()
    if (updated) syncDraftFromGroup(updated)
  })
}

onMounted(async () => {
  try {
    window.ztools?.setExpendHeight?.(560)
  } catch {
    // host optional
  }
  await loadAll()
})
</script>

<template>
  <div class="app-shell">
    <TopBar
      :last-scan-at="lastScanAt"
      :can-trial-run="canTrialRun"
      :busy="busy"
      @scan="onScan"
      @add-dir="onAddDir"
      @trial-run="onTrialRun"
    />

    <div v-if="loadError" class="shell-banner error-banner">加载失败：{{ loadError }}</div>

    <div v-if="!hasApps" class="empty-state empty-page">
      <div>还没有应用，先扫描一次吧</div>
      <button class="btn btn-primary" type="button" :disabled="busy" @click="onScan">
        扫描应用
      </button>
    </div>

    <div v-else class="main-layout">
      <CategorySidebar
        :categories="categories"
        :selected-category-id="selectedCategoryId"
        :collapsed="categoryCollapsed"
        :busy="busy"
        @select="selectedCategoryId = $event"
        @create="onCreateCategory"
        @rename="onRenameCategory"
        @delete="onDeleteCategory"
        @toggle-collapsed="toggleCategoryCollapsed"
      />

      <AppList
        :apps="apps"
        :categories="categories"
        :groups="displayGroups"
        :category-filter="categoryFilter"
        :selected-app-ids="selectedAppIds"
        :search-query="searchQuery"
        :can-add-to-category="canAddToCategory"
        :target-category-name="selectedCategoryName"
        :can-add-to-group="canAddToGroup"
        :busy="busy"
        @update:search-query="searchQuery = $event"
        @update:category-filter="categoryFilter = $event"
        @toggle-select="toggleSelect"
        @add-to-category="addAppToCategory"
        @add-to-group="addAppToGroup"
        @add-selected-to-group="addSelectedToGroup"
        @remove-from-category="removeAppFromCategory"
        @remove-from-group="removeAppFromGroup"
        @launch="onLaunchApp"
      />

      <div class="right-col" :class="{ 'is-collapsed': groupCollapsed }">
        <button
          class="btn-icon right-col__toggle"
          type="button"
          :title="groupCollapsed ? '展开启动组' : '收起启动组'"
          :aria-expanded="!groupCollapsed"
          @click="toggleGroupCollapsed"
        >
          <span aria-hidden="true">{{ groupCollapsed ? '‹' : '›' }}</span>
        </button>

        <template v-if="!groupCollapsed">
          <div v-if="!hasGroups && !draft" class="panel empty-groups">
            <div class="empty-state">
              <div>还没有启动组</div>
              <button class="btn btn-primary" type="button" @click="createGroup">创建启动组</button>
            </div>
          </div>
          <GroupPanel
            v-else
            :groups="groups"
            :apps="apps"
            :selected-group-id="selectedGroupId"
            :draft="draft"
            :save-error="saveError"
            :busy="busy"
            @select="selectGroup"
            @create="createGroup"
            @update:draft="draft = $event"
            @save="onSaveGroup"
            @delete="onDeleteGroup"
            @retry-sync="onRetrySync"
            @remove-member="removeMember"
          />
        </template>
        <div v-else class="right-rail" title="启动组">组</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.shell-banner {
  margin: 8px 12px 0;
}

.empty-page {
  flex: 1;
}

.main-layout {
  display: flex;
  gap: 10px;
  padding: 10px;
  flex: 1;
  min-height: 0;
}

.right-col {
  position: relative;
  width: var(--group-col);
  flex-shrink: 0;
  display: flex;
  min-height: 0;
  transition: width var(--ease);
}

.right-col.is-collapsed {
  width: var(--rail);
}

.right-col__toggle {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
}

.right-col.is-collapsed .right-col__toggle {
  left: 50%;
  transform: translateX(-50%);
}

.right-col > .panel,
.right-col > :deep(.group-panel) {
  flex: 1;
  width: 100%;
  min-width: 0;
}

.right-col:not(.is-collapsed) :deep(.panel-header) {
  padding-left: 40px;
}

.right-rail {
  flex: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 44px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  writing-mode: vertical-rl;
  letter-spacing: 0.2em;
}

.empty-groups {
  width: 100%;
}
</style>
