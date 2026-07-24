import { marked } from 'marked'
import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import { useConfirmDialog, useToast } from '@/components'
import type {
  DocItem,
  PluginDocContent,
  PluginItem,
  PluginMemoryInfo,
  TabId,
  TabItem,
} from './types'
import { cmdKey, formatDate, formatJsonData, normalizeCommand } from './utils'

marked.setOptions({
  breaks: true,
  gfm: true,
})

export interface UsePluginDetailOptions {
  plugin: Ref<PluginItem>
  isRunning?: Ref<boolean | undefined>
  showComments?: boolean
}

function normalizeConfigList(data: unknown): string[] {
  if (!Array.isArray(data)) return []

  return data
    .map((item) =>
      typeof item === 'string'
        ? item
        : typeof item === 'object' && item !== null && 'pluginName' in item
          ? String((item as { pluginName?: unknown }).pluginName ?? '')
          : ''
    )
    .filter(Boolean)
}

function toggleInList(list: string[], name: string): string[] {
  return list.includes(name) ? list.filter((item) => item !== name) : [...list, name]
}

async function readSettingList(key: string): Promise<string[]> {
  try {
    return normalizeConfigList(await window.ztools.internal.dbGet?.(key))
  } catch {
    return []
  }
}

async function togglePluginSetting(key: string, pluginName: string): Promise<string[]> {
  const nextList = toggleInList(await readSettingList(key), pluginName)
  await window.ztools.internal.dbPut?.(key, nextList)
  return nextList
}

function compareVersions(v1: string, v2: string): number {
  if (!v1 || !v2) return 0

  const parts1 = v1.split('.').map(Number)
  const parts2 = v2.split('.').map(Number)
  const length = Math.max(parts1.length, parts2.length)

  for (let index = 0; index < length; index += 1) {
    const num1 = parts1[index] || 0
    const num2 = parts2[index] || 0
    if (num1 < num2) return -1
    if (num1 > num2) return 1
  }

  return 0
}

function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return ''

  const mb = bytes / (1024 * 1024)
  if (mb >= 1) {
    return `${mb.toFixed(2)} MB`
  }

  const kb = bytes / 1024
  return `${kb.toFixed(2)} KB`
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误'
}

export function usePluginDetail(options: UsePluginDetailOptions) {
  const { plugin, isRunning, showComments = false } = options
  const { success, error } = useToast()
  const { confirm } = useConfirmDialog()

  const showSettingsDropdown = ref(false)
  const isAutoKill = ref(false)
  const isAutoDetach = ref(false)
  const isAutoStart = ref(false)

  const currentPluginName = computed(() => plugin.value.name || null)

  const activeTab = ref<TabId>('detail')
  const readmeContent = ref('')
  const readmeLoading = ref(false)
  const readmeError = ref('')

  const docKeys = ref<DocItem[]>([])
  const dataLoading = ref(false)
  const dataError = ref('')
  const expandedDataId = ref('')
  const currentDocContent = ref<PluginDocContent>(null)
  const currentDocType = ref<'document' | 'attachment'>('document')
  const isClearing = ref(false)

  const memoryInfo = ref<PluginMemoryInfo | null>(null)
  const memoryLoading = ref(false)
  let memoryUpdateTimer: ReturnType<typeof setInterval> | null = null

  const renderedMarkdown = computed(() => (readmeContent.value ? marked(readmeContent.value) : ''))

  const availableTabs = computed<TabItem[]>(() => {
    const tabs: TabItem[] = [
      { id: 'detail', label: '详情' },
      { id: 'commands', label: '指令列表' },
    ]

    if (plugin.value.installed) {
      tabs.push({ id: 'data', label: '数据' })
    }

    if (showComments) {
      tabs.push({ id: 'comments', label: '留言' })
    }

    return tabs
  })

  const canUpgrade = computed(() => {
    if (!plugin.value.installed || !plugin.value.localVersion || !plugin.value.version) return false
    return compareVersions(plugin.value.localVersion, plugin.value.version) < 0
  })

  function handleClickOutside(): void {
    showSettingsDropdown.value = false
  }

  function toggleSettingsDropdown(): void {
    showSettingsDropdown.value = !showSettingsDropdown.value
  }

  async function loadPluginSettings(): Promise<void> {
    if (!currentPluginName.value) return

    const [killList, detachList, startList] = await Promise.all([
      readSettingList('outKillPlugin'),
      readSettingList('autoDetachPlugin'),
      readSettingList('autoStartPlugin'),
    ])

    isAutoKill.value = killList.includes(currentPluginName.value)
    isAutoDetach.value = detachList.includes(currentPluginName.value)
    isAutoStart.value = startList.includes(currentPluginName.value)
  }

  async function toggleAutoKill(): Promise<void> {
    if (!currentPluginName.value) return

    const list = await togglePluginSetting('outKillPlugin', currentPluginName.value)
    isAutoKill.value = list.includes(currentPluginName.value)
  }

  async function toggleAutoDetach(): Promise<void> {
    if (!currentPluginName.value) return

    const list = await togglePluginSetting('autoDetachPlugin', currentPluginName.value)
    isAutoDetach.value = list.includes(currentPluginName.value)
  }

  async function toggleAutoStart(): Promise<void> {
    if (!currentPluginName.value) return

    const list = await togglePluginSetting('autoStartPlugin', currentPluginName.value)
    isAutoStart.value = list.includes(currentPluginName.value)
  }

  function switchTab(tabId: TabId): void {
    activeTab.value = tabId

    if (tabId === 'data' && !docKeys.value.length && !dataLoading.value) {
      void loadPluginData()
    }
  }

  async function loadReadme(): Promise<void> {
    readmeLoading.value = true
    readmeError.value = ''

    try {
      if (plugin.value.installed && plugin.value.path) {
        const localReadme = await window.ztools.internal.getPluginReadme?.(plugin.value.path)
        if (localReadme?.success && localReadme.content) {
          readmeContent.value = localReadme.content
          return
        }

        if (plugin.value.name) {
          const remoteReadme = await window.ztools.internal.getPluginReadme?.(plugin.value.name)
          if (remoteReadme?.success && remoteReadme.content) {
            readmeContent.value = remoteReadme.content
            return
          }
        }

        readmeError.value = '暂无详情'
        return
      }

      if (plugin.value.name) {
        const result = await window.ztools.internal.getPluginReadme?.(plugin.value.name)
        if (result?.success && result.content) {
          readmeContent.value = result.content
        } else {
          readmeError.value = result?.error || '加载失败'
        }
        return
      }

      readmeError.value = '插件信息不完整'
    } catch (error) {
      console.error('加载 README 失败:', error)
      readmeError.value = '读取失败'
    } finally {
      readmeLoading.value = false
    }
  }

  async function loadPluginData(): Promise<void> {
    if (!currentPluginName.value) {
      dataError.value = '插件名称不存在'
      return
    }

    dataLoading.value = true
    dataError.value = ''

    try {
      const result = await window.ztools.internal.getPluginDocKeys?.(currentPluginName.value)
      if (result?.success) {
        docKeys.value = result.data || []
      } else {
        dataError.value = result?.error || '获取失败'
      }
    } catch (error) {
      console.error('加载插件数据失败:', error)
      dataError.value = '获取失败'
    } finally {
      dataLoading.value = false
    }
  }

  async function handleClearAllData(): Promise<void> {
    if (!currentPluginName.value || isClearing.value) return

    const confirmed = await confirm({
      title: '清除全部数据',
      message: `确定要清除插件"${plugin.value.name}"的全部数据吗？\n\n⚠️ 警告：此操作将永久删除该插件存储的所有数据，包括文档和附件。\n\n此操作不可恢复，请谨慎操作！`,
      type: 'danger',
      confirmText: '清除',
      cancelText: '取消',
    })
    if (!confirmed) return

    isClearing.value = true
    try {
      const result = await window.ztools.internal.clearPluginData?.(currentPluginName.value)
      if (result?.success) {
        success('插件数据已清除')
        expandedDataId.value = ''
        currentDocContent.value = null
        await loadPluginData()
      } else {
        error(`清除失败: ${result?.error || '未知错误'}`)
      }
    } catch (caughtError) {
      console.error('清除插件数据失败:', caughtError)
      error(`清除失败: ${getErrorMessage(caughtError)}`)
    } finally {
      isClearing.value = false
    }
  }

  async function handleUninstall(emitFn: () => void): Promise<void> {
    const confirmed = await confirm({
      title: '删除插件',
      message: `确定要删除插件"${plugin.value.name}"吗？\n\n此操作将删除插件文件，无法恢复。`,
      type: 'danger',
      confirmText: '删除',
      cancelText: '取消',
    })

    if (confirmed) {
      emitFn()
    }
  }

  async function toggleDataDetail(item: DocItem): Promise<void> {
    if (!currentPluginName.value) return

    if (expandedDataId.value === item.key) {
      expandedDataId.value = ''
      currentDocContent.value = null
      return
    }

    expandedDataId.value = item.key
    currentDocType.value = item.type

    try {
      const result = await window.ztools.internal.getPluginDoc?.(currentPluginName.value, item.key)
      if (result?.success) {
        currentDocContent.value = result.data ?? null
        currentDocType.value = result.type || 'document'
      } else {
        currentDocContent.value = { error: result?.error || '加载失败' }
      }
    } catch (error) {
      console.error('加载文档内容失败:', error)
      currentDocContent.value = { error: '加载失败' }
    }
  }

  function openHomepage(): void {
    if (plugin.value.homepage) {
      window.ztools.shellOpenExternal(plugin.value.homepage)
    }
  }

  async function loadMemoryInfo(): Promise<void> {
    if (!plugin.value.path || !isRunning?.value) {
      memoryInfo.value = null
      return
    }

    memoryLoading.value = true
    try {
      const result = await window.ztools.internal.getPluginMemoryInfo?.(plugin.value.path)
      memoryInfo.value = result?.success && result.data ? result.data : null
    } catch (error) {
      console.error('[PluginDetail] 获取插件内存信息失败:', error)
      memoryInfo.value = null
    } finally {
      memoryLoading.value = false
    }
  }

  function startMemoryUpdate(): void {
    void loadMemoryInfo()

    if (memoryUpdateTimer) {
      clearInterval(memoryUpdateTimer)
    }

    memoryUpdateTimer = setInterval(() => {
      void loadMemoryInfo()
    }, 3000)
  }

  function stopMemoryUpdate(): void {
    if (memoryUpdateTimer) {
      clearInterval(memoryUpdateTimer)
      memoryUpdateTimer = null
    }

    memoryInfo.value = null
  }

  onMounted(() => {
    if (plugin.value.name || plugin.value.path) {
      void loadReadme()
    }

    if (plugin.value.installed && plugin.value.name) {
      void loadPluginSettings()
    }

    if (isRunning?.value) {
      startMemoryUpdate()
    }

    document.addEventListener('click', handleClickOutside)
  })

  onUnmounted(() => {
    document.removeEventListener('click', handleClickOutside)
    stopMemoryUpdate()
  })

  watch(
    () => plugin.value.name,
    () => {
      if (plugin.value.installed && plugin.value.name) {
        void loadPluginSettings()
      }
    }
  )

  watch(
    () => isRunning?.value,
    (running) => {
      if (running) {
        startMemoryUpdate()
      } else {
        stopMemoryUpdate()
      }
    }
  )

  return {
    showSettingsDropdown,
    isAutoKill,
    isAutoDetach,
    isAutoStart,
    currentPluginName,
    toggleSettingsDropdown,
    toggleAutoKill,
    toggleAutoDetach,
    toggleAutoStart,
    activeTab,
    availableTabs,
    switchTab,
    readmeContent,
    readmeLoading,
    readmeError,
    renderedMarkdown,
    docKeys,
    dataLoading,
    dataError,
    expandedDataId,
    currentDocContent,
    currentDocType,
    isClearing,
    handleClearAllData,
    toggleDataDetail,
    memoryInfo,
    memoryLoading,
    canUpgrade,
    handleUninstall,
    cmdKey,
    normalizeCommand,
    formatJsonData,
    formatDate,
    formatSize,
    openHomepage,
  }
}
