<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppList from './components/AppList.vue'
import CategorySidebar from './components/CategorySidebar.vue'
import GroupPanel, { type GroupDraft } from './components/GroupPanel.vue'
import TopBar from './components/TopBar.vue'
import type { AppDoc, CategoryDoc, GroupDoc, LaunchResult, SettingsDoc } from './types'

const apps = ref<AppDoc[]>([])
const categories = ref<CategoryDoc[]>([])
const groups = ref<GroupDoc[]>([])
const settings = ref<SettingsDoc | null>(null)

const selectedCategoryId = ref<string | null>(null)
const selectedGroupId = ref<string | null>(null)
const selectedAppIds = ref<string[]>([])
const searchQuery = ref('')

const draft = ref<GroupDraft | null>(null)
const saveError = ref<string | null>(null)
const busy = ref(false)
const loadError = ref<string | null>(null)

const api = () => window.batchStart

const lastScanAt = computed(() => settings.value?.lastScanAt ?? null)
const hasApps = computed(() => apps.value.length > 0)
const hasGroups = computed(() => groups.value.length > 0)
const canTrialRun = computed(() => selectedGroupId.value != null || !!draft.value?.id)

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
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err)
  }
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

async function onCreateCategory() {
  const name = window.prompt('新分类名称')
  if (!name?.trim()) return
  await withBusy(async () => {
    await api().createCategory(name.trim())
    await loadAll()
  })
}

async function onRenameCategory(id: string) {
  const current = categories.value.find((c) => c._id === id)
  const name = window.prompt('重命名分类', current?.name ?? '')
  if (!name?.trim()) return
  await withBusy(async () => {
    await api().renameCategory(id, name.trim())
    await loadAll()
  })
}

async function onDeleteCategory(id: string) {
  if (!window.confirm('删除该分类？其下应用将回到未分类。')) return
  await withBusy(async () => {
    await api().deleteCategory(id)
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

async function onAssignCategory(appId: string, categoryId: string | null) {
  await withBusy(async () => {
    await api().assignCategory(appId, categoryId)
    await loadAll()
  })
}

function addSelectedToGroup() {
  if (!draft.value) createGroup()
  const current = draft.value!
  const set = new Set(current.appIds)
  for (const id of selectedAppIds.value) set.add(id)
  draft.value = { ...current, appIds: [...set] }
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
        @select="selectedCategoryId = $event"
        @create="onCreateCategory"
        @rename="onRenameCategory"
        @delete="onDeleteCategory"
      />

      <AppList
        :apps="apps"
        :categories="categories"
        :selected-category-id="selectedCategoryId"
        :selected-app-ids="selectedAppIds"
        :search-query="searchQuery"
        @update:search-query="searchQuery = $event"
        @toggle-select="toggleSelect"
        @assign-category="onAssignCategory"
        @add-selected-to-group="addSelectedToGroup"
      />

      <div class="right-col">
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
  width: 300px;
  flex-shrink: 0;
  display: flex;
  min-height: 0;
}

.right-col > .panel,
.right-col > :deep(.group-panel) {
  flex: 1;
  width: 100%;
}

.empty-groups {
  width: 100%;
}
</style>
