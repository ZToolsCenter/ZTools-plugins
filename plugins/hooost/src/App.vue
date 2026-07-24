<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Environment, EnvironmentStore, ParsedEnvironmentBlock } from '@/types/hosts'
import {
  buildGroupEndMarker,
  buildGroupHeader,
  extractPublicContent,
  isReservedEnvironmentName,
  mergeHostsContent,
  normalizeManagedEnvironmentMarkers,
  parseEnvironmentBlocks,
  parseSourceToLines,
} from '@/lib/hosts'
import { ConfirmDialog, Toast, useConfirmDialog, useToast } from '@/components'
import { createCustomEnvironmentId, normalizeStore, useEnvironmentStorage } from '@/composables'
import EnvironmentEditor from '@/components/EnvironmentEditor.vue'
import EnvironmentList from '@/components/EnvironmentList.vue'

type ThemePayload = {
  isDark: boolean
  windowMaterial: string
  primaryColor?: string
  customColor?: string
}

type ServiceActionResult = {
  success: boolean
  error?: string
}

const { toastState, success, error: showError } = useToast()
const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmDialog()
const { loadStore, saveStore } = useEnvironmentStorage()

const store = ref<EnvironmentStore>({
  initialized: true,
  activeEnvironmentIds: [],
  environments: [],
})
const hostsBaseContent = ref('')
const publicReadonlyContent = ref('')
const selectedEnvironmentId = ref<string | null>(null)
const loading = ref(false)
const draftEnvironments = ref<Record<string, Environment>>({})

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function cloneEnvironment(environment: Environment): Environment {
  return {
    ...environment,
    lines: environment.lines.map((line) => ({ ...line })),
  }
}

function normalizeEnvironment(environment: Environment): string {
  return JSON.stringify({
    id: environment.id,
    name: environment.name,
    type: environment.type,
    enabled: environment.enabled,
    editMode: environment.editMode,
    header: environment.header,
    endMarker: environment.endMarker,
    lines: environment.lines,
  })
}

function getStoredEnvironment(envId: string): Environment | null {
  return store.value.environments.find((environment) => environment.id === envId) ?? null
}

function isPublicEnvironment(envId: string): boolean {
  return getStoredEnvironment(envId)?.type === 'public'
}

function isCustomEnvironment(envId: string): boolean {
  return getStoredEnvironment(envId)?.type === 'custom'
}

function getEditableEnvironment(envId: string): Environment | null {
  return draftEnvironments.value[envId] ?? getStoredEnvironment(envId)
}

function ensureDraft(envId: string): Environment | null {
  if (isPublicEnvironment(envId)) return null

  const existingDraft = draftEnvironments.value[envId]
  if (existingDraft) return existingDraft

  const storedEnvironment = getStoredEnvironment(envId)
  if (!storedEnvironment) return null

  const draft = cloneEnvironment(storedEnvironment)
  draftEnvironments.value = {
    ...draftEnvironments.value,
    [envId]: draft,
  }
  return draft
}

function clearDraft(envId: string): void {
  const nextDrafts = { ...draftEnvironments.value }
  delete nextDrafts[envId]
  draftEnvironments.value = nextDrafts
}

const selectedEnvironment = computed(() => {
  if (!selectedEnvironmentId.value) return null
  return getEditableEnvironment(selectedEnvironmentId.value)
})

const activeEnvironmentIds = computed(() => new Set(store.value.activeEnvironmentIds))

const hasPendingChanges = computed(() => {
  if (!selectedEnvironmentId.value) return false

  const draft = draftEnvironments.value[selectedEnvironmentId.value]
  const storedEnvironment = getStoredEnvironment(selectedEnvironmentId.value)
  if (!draft || !storedEnvironment) return false

  return normalizeEnvironment(draft) !== normalizeEnvironment(storedEnvironment)
})

function persistStore(): void {
  store.value = normalizeStore(store.value)
  saveStore(store.value)
}

function normalizeEnvironmentName(name: string): string {
  return name.trim()
}

function isEnvironmentNameTaken(name: string, excludeEnvId?: string): boolean {
  const normalizedName = normalizeEnvironmentName(name)
  if (!normalizedName) return false

  return (
    store.value.environments.some(
      (environment) =>
        environment.id !== excludeEnvId &&
        normalizeEnvironmentName(environment.name) === normalizedName
    ) ||
    Object.values(draftEnvironments.value).some(
      (environment) =>
        environment.id !== excludeEnvId &&
        normalizeEnvironmentName(environment.name) === normalizedName
    )
  )
}

function validateCustomEnvironmentName(name: string, excludeEnvId?: string): string | null {
  const normalizedName = normalizeEnvironmentName(name)
  if (!normalizedName) {
    showError('配置名称不能为空')
    return null
  }

  if (isReservedEnvironmentName(normalizedName)) {
    showError(`配置名称「${normalizedName}」为内置保留名称`)
    return null
  }

  if (isEnvironmentNameTaken(normalizedName, excludeEnvId)) {
    showError(`配置名称「${normalizedName}」已存在`)
    return null
  }

  return normalizedName
}

function createEnvironmentFromParsedBlock(
  parsedEnvironment: ParsedEnvironmentBlock,
  existingEnvironment?: Environment
): Environment {
  const now = new Date().toISOString()

  return {
    id: existingEnvironment?.id ?? createCustomEnvironmentId(),
    name: parsedEnvironment.name,
    type: 'custom',
    enabled: false,
    editMode: 'source',
    header: parsedEnvironment.header,
    endMarker: parsedEnvironment.endMarker,
    lines: parsedEnvironment.lines,
    updatedAt: existingEnvironment?.updatedAt ?? now,
  }
}

function syncEnvironmentsFromHosts(fullHosts: string): void {
  const parsedEnvironments = parseEnvironmentBlocks(fullHosts)
  const currentStore = normalizeStore(store.value)
  const parsedPublic = parsedEnvironments.find((environment) => environment.type === 'public')
  const parsedCustoms = parsedEnvironments.filter((environment) => environment.type === 'custom')

  const existingCustoms = currentStore.environments
    .filter((environment) => environment.type === 'custom')
    .map((environment) => ({
      ...environment,
      enabled: false,
    }))

  const syncedCustoms = parsedCustoms.map((parsedEnvironment) => {
    const existingEnvironment =
      existingCustoms.find((environment) => environment.header === parsedEnvironment.header) ??
      existingCustoms.find((environment) => environment.name === parsedEnvironment.name)

    return {
      ...createEnvironmentFromParsedBlock(parsedEnvironment, existingEnvironment),
      enabled: true,
    }
  })

  const syncedCustomById = new Map(
    syncedCustoms.map((environment) => [environment.id, environment])
  )
  const existingCustomIds = new Set(existingCustoms.map((environment) => environment.id))
  const orderedCustoms = [
    ...existingCustoms.map((environment) => syncedCustomById.get(environment.id) ?? environment),
    ...syncedCustoms.filter((environment) => !existingCustomIds.has(environment.id)),
  ]
  const nextActiveEnvironmentIds = [
    'env-public',
    ...orderedCustoms
      .filter((environment) => syncedCustomById.has(environment.id))
      .map((environment) => environment.id),
  ]
  const publicEnvironment = currentStore.environments.find(
    (environment) => environment.type === 'public'
  )

  store.value = normalizeStore({
    initialized: true,
    activeEnvironmentIds: nextActiveEnvironmentIds,
    environments: [
      parsedPublic && publicEnvironment
        ? {
            ...publicEnvironment,
            lines: parsedPublic.lines,
            enabled: true,
          }
        : (publicEnvironment ?? currentStore.environments[0]),
      ...orderedCustoms,
    ].filter((environment): environment is Environment => !!environment),
  })

  const selectedExists =
    selectedEnvironmentId.value &&
    store.value.environments.some((environment) => environment.id === selectedEnvironmentId.value)

  selectedEnvironmentId.value = selectedExists
    ? selectedEnvironmentId.value
    : (store.value.environments[0]?.id ?? null)
}

async function loadHostsStateFromSystem(repairMarkers = false): Promise<void> {
  let currentHosts = window.services.readHosts()

  if (repairMarkers) {
    const normalizedHosts = normalizeManagedEnvironmentMarkers(currentHosts)
    if (normalizedHosts !== currentHosts) {
      const repairedHosts = normalizedHosts.endsWith('\n')
        ? normalizedHosts
        : `${normalizedHosts}\n`
      const repairResult = await window.services.applyHosts(repairedHosts, 'normalize')

      if (repairResult.success) {
        currentHosts = window.services.readHosts()
      } else {
        showError(`补全配置结束标记失败: ${repairResult.error || '未知错误'}`)
      }
    }
  }

  syncEnvironmentsFromHosts(currentHosts)
  hostsBaseContent.value = extractPublicContent(currentHosts)
  publicReadonlyContent.value = currentHosts
}

async function loadAll(): Promise<void> {
  try {
    store.value = loadStore()
    await loadHostsStateFromSystem(true)
    draftEnvironments.value = {}
  } catch (error) {
    showError(`加载数据失败: ${getErrorMessage(error)}`)
  }
}

function onSourceChange(envId: string, content: string): void {
  if (isPublicEnvironment(envId)) return

  const environment = ensureDraft(envId)
  if (!environment) return

  environment.lines = parseSourceToLines(content)
}

function updateName(envId: string, name: string): void {
  if (!isCustomEnvironment(envId)) return

  const environment = ensureDraft(envId)
  if (!environment) return

  const normalizedName = validateCustomEnvironmentName(name, envId)
  if (!normalizedName) return

  environment.name = normalizedName
  environment.header = buildGroupHeader(normalizedName)
  environment.endMarker = buildGroupEndMarker(normalizedName)
}

async function saveEnvironmentDraft(envId: string): Promise<void> {
  if (isPublicEnvironment(envId)) return

  const draft = draftEnvironments.value[envId]
  const environmentIndex = store.value.environments.findIndex(
    (environment) => environment.id === envId
  )
  if (!draft || environmentIndex === -1) return

  const savedEnvironment = cloneEnvironment(draft)
  if (savedEnvironment.type === 'custom') {
    const normalizedName = validateCustomEnvironmentName(savedEnvironment.name, envId)
    if (!normalizedName) return

    savedEnvironment.name = normalizedName
    savedEnvironment.header = buildGroupHeader(normalizedName)
    savedEnvironment.endMarker = buildGroupEndMarker(normalizedName)
  }

  savedEnvironment.updatedAt = new Date().toISOString()
  store.value.environments[environmentIndex] = savedEnvironment

  if (store.value.activeEnvironmentIds.includes(envId)) {
    await runServiceAction({
      run: () => window.services.applyHosts(getMergedContent(), savedEnvironment.name),
      failureMessage: '保存配置失败',
      successMessage: `已保存配置「${savedEnvironment.name}」`,
      onSuccess: () => {
        persistStore()
        clearDraft(envId)
      },
    })
    return
  }

  persistStore()
  clearDraft(envId)
  success(`已保存配置「${savedEnvironment.name}」`)
}

function cancelEnvironmentDraft(envId: string): void {
  if (isPublicEnvironment(envId)) return

  const environment = getStoredEnvironment(envId)
  clearDraft(envId)
  if (environment) {
    success(`已取消配置「${environment.name}」的未保存修改`)
  }
}

function createEnvironment(): void {
  let name = '新配置'
  let index = 2

  while (isEnvironmentNameTaken(name) || isReservedEnvironmentName(name)) {
    name = `新配置 ${index}`
    index += 1
  }

  const newEnvironment: Environment = {
    id: createCustomEnvironmentId(),
    name,
    type: 'custom',
    enabled: false,
    editMode: 'source',
    header: buildGroupHeader(name),
    endMarker: buildGroupEndMarker(name),
    lines: [],
    updatedAt: new Date().toISOString(),
  }

  store.value.environments = [...store.value.environments, newEnvironment]
  persistStore()
  selectedEnvironmentId.value = newEnvironment.id
  success(`已新增配置「${newEnvironment.name}」`)
}

function reorderEnvironments(orderedIds: string[]): void {
  const publicEnvironment = store.value.environments.find(
    (environment) => environment.type === 'public'
  )
  if (!publicEnvironment) return

  const customEnvironments = store.value.environments.filter(
    (environment) => environment.type === 'custom'
  )
  const customEnvironmentById = new Map(
    customEnvironments.map((environment) => [environment.id, environment])
  )
  const orderedCustomEnvironments = orderedIds
    .map((id) => customEnvironmentById.get(id))
    .filter((environment): environment is Environment => !!environment)
  const orderedCustomIds = new Set(orderedCustomEnvironments.map((environment) => environment.id))
  const activeCustomIds = orderedIds.filter((id) => store.value.activeEnvironmentIds.includes(id))

  store.value.environments = [
    publicEnvironment,
    ...orderedCustomEnvironments,
    ...customEnvironments.filter((environment) => !orderedCustomIds.has(environment.id)),
  ]
  store.value.activeEnvironmentIds = ['env-public', ...activeCustomIds]
  persistStore()
}

function getActiveEnvironments(nextActiveIds = store.value.activeEnvironmentIds): Environment[] {
  return nextActiveIds
    .map((id) => store.value.environments.find((environment) => environment.id === id))
    .filter(
      (environment): environment is Environment => !!environment && environment.type !== 'public'
    )
}

function getMergedContent(nextActiveIds = store.value.activeEnvironmentIds): string {
  const baseContent = hostsBaseContent.value || extractPublicContent(window.services.readHosts())
  const activeEnvironments = getActiveEnvironments(nextActiveIds)
  return `${mergeHostsContent(baseContent, activeEnvironments).trimEnd()}\n`
}

async function runServiceAction(options: {
  run: () => Promise<ServiceActionResult>
  failureMessage: string
  successMessage: string
  onSuccess?: () => void
}): Promise<boolean> {
  loading.value = true

  try {
    const result = await options.run()
    if (!result.success) {
      showError(`${options.failureMessage}: ${result.error || '未知错误'}`)
      return false
    }

    options.onSuccess?.()
    await loadHostsStateFromSystem()
    success(options.successMessage)
    return true
  } catch (error) {
    showError(`${options.failureMessage}: ${getErrorMessage(error)}`)
    return false
  } finally {
    loading.value = false
  }
}

async function deleteEnvironment(envId: string): Promise<void> {
  const environment = store.value.environments.find((item) => item.id === envId)
  if (!environment || environment.type !== 'custom') return

  const isActive = store.value.activeEnvironmentIds.includes(envId)
  const confirmed = await confirm({
    title: '删除配置',
    message: isActive
      ? `配置「${environment.name}」当前已启用，删除将同时停用。确定要删除吗？`
      : `确定要删除配置「${environment.name}」吗？`,
    type: 'danger',
    confirmText: '删除',
    cancelText: '取消',
  })
  if (!confirmed) return

  const nextActiveIds = store.value.activeEnvironmentIds.filter((activeId) => activeId !== envId)
  await runServiceAction({
    run: () =>
      window.services.applyHosts(
        getMergedContent(nextActiveIds),
        isActive ? 'deactivate' : environment.name
      ),
    failureMessage: isActive ? '停用失败' : '删除失败',
    successMessage: `已删除配置「${environment.name}」`,
    onSuccess: () => {
      store.value.activeEnvironmentIds = nextActiveIds
      store.value.environments = store.value.environments.filter((item) => item.id !== envId)
      clearDraft(envId)
      if (selectedEnvironmentId.value === envId) {
        selectedEnvironmentId.value = store.value.environments[0]?.id ?? null
      }
      persistStore()
    },
  })
}

async function applyEnvironment(envId: string): Promise<void> {
  const environment = store.value.environments.find((item) => item.id === envId)
  if (!environment || environment.type === 'public') return

  const enabledHostLines = environment.lines.filter(
    (line) => line.type === 'host' && line.enabled && line.domain && line.ip
  )
  if (enabledHostLines.length === 0) {
    showError('当前配置没有启用的条目')
    return
  }

  const nextActiveIds = store.value.activeEnvironmentIds.includes(envId)
    ? store.value.activeEnvironmentIds
    : [...store.value.activeEnvironmentIds, envId]

  await runServiceAction({
    run: () => window.services.applyHosts(getMergedContent(nextActiveIds), environment.name),
    failureMessage: '写入 hosts 失败',
    successMessage: `已启用配置「${environment.name}」`,
    onSuccess: () => {
      store.value.activeEnvironmentIds = nextActiveIds
      persistStore()
    },
  })
}

async function deactivateEnvironment(envId: string): Promise<void> {
  const environment = store.value.environments.find((item) => item.id === envId)
  if (!environment || !store.value.activeEnvironmentIds.includes(envId)) return

  const confirmed = await confirm({
    title: '停用配置',
    message: `确定要停用配置「${environment.name}」吗？`,
    type: 'warning',
    confirmText: '停用',
    cancelText: '取消',
  })
  if (!confirmed) return

  const nextActiveIds = store.value.activeEnvironmentIds.filter((activeId) => activeId !== envId)
  await runServiceAction({
    run: () => window.services.applyHosts(getMergedContent(nextActiveIds), 'deactivate'),
    failureMessage: '停用失败',
    successMessage: `已停用配置「${environment.name}」`,
    onSuccess: () => {
      store.value.activeEnvironmentIds = nextActiveIds
      persistStore()
    },
  })
}

function applyTheme(theme: ThemePayload): void {
  document.documentElement.setAttribute('data-material', theme.windowMaterial)
  document.documentElement.classList.toggle('dark', theme.isDark)

  const themeClasses = [
    'theme-blue',
    'theme-purple',
    'theme-green',
    'theme-orange',
    'theme-red',
    'theme-pink',
    'theme-custom',
  ]
  document.body.classList.remove(...themeClasses)

  if (theme.primaryColor) {
    document.body.classList.add(`theme-${theme.primaryColor}`)
  }

  if (theme.customColor) {
    document.documentElement.style.setProperty('--primary-color', theme.customColor)
  }
}

function applyOsClass(platform: string): void {
  document.documentElement.classList.remove('os-mac', 'os-windows', 'os-linux')

  if (platform === 'darwin') {
    document.documentElement.classList.add('os-mac')
  } else if (platform === 'win32') {
    document.documentElement.classList.add('os-windows')
  } else {
    document.documentElement.classList.add('os-linux')
  }
}

onMounted(() => {
  applyTheme(window.services.getThemeInfo())
  window.services.onThemeChange((theme) => applyTheme(theme))
  applyOsClass(window.services.getSystemInfo().platform)

  window.ztools.onPluginEnter(() => {
    void loadAll()
  })

  void loadAll()
})
</script>

<template>
  <div class="app" :class="{ 'app--loading': loading }">
    <div class="app-body">
      <EnvironmentList
        :environments="store.environments"
        :active-environment-ids="store.activeEnvironmentIds"
        :selected-environment-id="selectedEnvironmentId"
        @select="(id: string) => (selectedEnvironmentId = id)"
        @apply="applyEnvironment"
        @deactivate="deactivateEnvironment"
        @delete="deleteEnvironment"
        @create="createEnvironment"
        @reorder="reorderEnvironments"
      />

      <div class="app-main">
        <EnvironmentEditor
          v-if="selectedEnvironment"
          :environment="selectedEnvironment"
          :public-readonly-content="publicReadonlyContent"
          :is-active="activeEnvironmentIds.has(selectedEnvironment.id)"
          :has-pending-changes="hasPendingChanges"
          @source-change="onSourceChange"
          @update-name="updateName"
          @save-draft="saveEnvironmentDraft"
          @cancel-draft="cancelEnvironmentDraft"
        />
        <div v-else class="app-empty">
          <p>选择一个配置开始管理</p>
        </div>
      </div>
    </div>

    <Toast
      :message="toastState.message"
      :type="toastState.type"
      :duration="toastState.duration"
      :visible="toastState.visible"
      @update:visible="
        (visible: boolean) => {
          if (!visible) toastState.visible = false
        }
      "
    />
    <ConfirmDialog
      :visible="confirmState.visible"
      :title="confirmState.title"
      :message="confirmState.message"
      :type="confirmState.type"
      :confirm-text="confirmState.confirmText"
      :cancel-text="confirmState.cancelText"
      @confirm="handleConfirm"
      @cancel="handleCancel"
      @update:visible="
        (visible: boolean) => {
          if (!visible) handleCancel()
        }
      "
    />
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
}

.app--loading {
  opacity: 0.7;
  pointer-events: none;
}

.app-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.app-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow-y: hidden;
  padding: 8px 12px;
}

.app-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 120px;
  color: var(--text-color-secondary, #888);
}
</style>
