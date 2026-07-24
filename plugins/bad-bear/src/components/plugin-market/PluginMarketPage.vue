<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ZButton, ZCheckbox, ZModal } from 'ztools-ui'
import {
  applyMarketInstalledPluginHashes,
  buildMarketPluginUpdateCheckItems,
  checkPluginUpdates,
  getCurrentPlatform,
  getInstalledPlugins,
  getRunningPlugins,
  normalizeSha256Hash,
  readMarketInstalledPluginHashes,
  streamPluginMarket,
} from '../../api/pluginMarket'
import { useToast } from '../common'
import { useMarketRiskDialog } from '../../app/useMarketRiskDialog'
import authGuideImage from '../../assets/image/image.png?url'
import type {
  CategoryInfo,
  CategoryLayoutSection,
  InstalledPlugin,
  InstalledViewPlugin,
  PluginDetailVersion,
  PluginMarketFetchResponse,
  PluginMarketSectionModel,
  PluginMarketStreamSnapshot,
  PluginMarketUiPlugin,
  StorefrontCategorySummary,
} from '../../types/pluginMarket'
import AccountPanel from './AccountPanel.vue'
import ApiSettingsPanel from './ApiSettingsPanel.vue'
import CategoryCard from './CategoryCard.vue'
import CategoryDetail from './CategoryDetail.vue'
import InstalledPluginCard from './InstalledPluginCard.vue'
import NotificationPanel from './NotificationPanel.vue'
import PluginCard from './PluginCard.vue'
import PluginDetail from './PluginDetail.vue'
import PluginUploadPanel from './PluginUploadPanel.vue'
import RefreshButton from './RefreshButton.vue'
import { shuffleArray, weightedSearch } from './utils'
import type { ActiveNav } from './page/shared'
import { isPluginHostPermissionDeniedError } from './page/shared'
import { usePluginMarketActions } from './page/usePluginMarketActions'
import { usePluginMarketDetail } from './page/usePluginMarketDetail'
import { usePluginMarketNavigation } from './page/usePluginMarketNavigation'
import { usePluginMarketNotifications } from './page/usePluginMarketNotifications'
import { usePluginMarketSelection } from './page/usePluginMarketSelection'
import { usePluginMarketUploads } from './page/usePluginMarketUploads'
import { usePluginMarketRuntime } from './page/usePluginMarketRuntime'
import { useStoreSubInput } from './page/useStoreSubInput'
import {
  buildMarketViewState,
  finalizeMarketSnapshot,
  mergeMarketSnapshots,
} from './page/storefront'

interface SideNavItem {
  key: ActiveNav
  label: string
  badge?: string | number
  visible?: boolean
}

const activeNav = ref<ActiveNav>('store')
const isLoading = ref(true)
const isRefreshingMarket = ref(false)
const isMarketStreamActive = ref(false)
const hasLoadedMarketOnce = ref(false)
const loadError = ref('')
const canUseInternalPluginApis = ref(true)
const plugins = ref<PluginMarketUiPlugin[]>([])
const installedPlugins = ref<InstalledPlugin[]>([])
const installedViewPlugins = ref<InstalledViewPlugin[]>([])
const installedUpdateHashes = ref<Record<string, string>>({})
const runningPluginPaths = ref<string[]>([])
const storefrontSections = ref<PluginMarketSectionModel[]>([])
const storefrontCategories = ref<Record<string, CategoryInfo>>({})
const categoryLayouts = ref<Record<string, CategoryLayoutSection[]>>({})
const selectedCategoryKey = ref<string | null>(null)
const selectedPluginName = ref<string | null>(null)
const searchQuery = ref('')
let reloadSelectedPluginDetailRef: () => Promise<void> = async () => {}
let refreshNotificationsAfterAuthChangeRef: () => Promise<void> = async () => {}
let marketReloadSessionId = 0
let marketReloadAbortController: AbortController | null = null
let stableMarketResponse: PluginMarketFetchResponse | null = null
let latestStreamMarketResponse: PluginMarketStreamSnapshot | null = null

function isInternalPlugin(_name: string): boolean {
  return false
}

const {
  success: showSuccessToast,
  error: showErrorToast,
  confirm,
} = useToast()

const {
  marketRiskDialogState,
  hasDismissedMarketRiskDialog,
  canSubmitMarketRiskDialog,
  openMarketRiskDialog,
  confirmOpenPluginRisk,
  updateMarketRiskChecklistItem,
  handleMarketRiskConfirm,
  handleMarketRiskCancel,
  handleMarketRiskVisibleChange,
  internalApiAuthGuideVisible,
  hasDismissedInternalApiAuthGuide,
  pluginName,
  openInternalApiAuthGuide,
  closeInternalApiAuthGuide,
  dismissInternalApiAuthGuide,
} = useMarketRiskDialog()

let authGuideTimerId: ReturnType<typeof setTimeout> | null = null

function notifyError(message: string) {
  showErrorToast(message)
}

function notifySuccess(message: string) {
  showSuccessToast(message)
}

async function confirmAction(options: {
  title?: string
  message: string
  type?: 'info' | 'warning' | 'danger'
  confirmText?: string
  cancelText?: string
}): Promise<boolean> {
  return confirm(options)
}

function openPluginByName(name: string) {
  selectedPluginName.value = name
}

/**
 * 查询可更新插件并转换为按插件名索引的 latestHash 表，失败时不影响已安装列表加载。
 */
async function loadInstalledUpdateHashes(
  pluginsToCheck: InstalledPlugin[],
  hashRecords = readMarketInstalledPluginHashes(),
): Promise<Record<string, string>> {
  const items = buildMarketPluginUpdateCheckItems(pluginsToCheck, hashRecords)
  if (items.length === 0) {
    return {}
  }

  try {
    const updates = await checkPluginUpdates(items)
    return Object.fromEntries(
      updates
        .map((item) => ({ name: item.name, latestHash: normalizeSha256Hash(item.latestHash) }))
        .filter((item): item is { name: string; latestHash: string } => !!item.name && !!item.latestHash)
        .map((item) => [item.name, item.latestHash]),
    )
  } catch (error) {
    console.warn('[PluginMarket] 检查插件更新失败:', error)
    return {}
  }
}

// Sub-input composable for market search
const {
  syncStoreSubInput,
  focusSubInput,
  clearSearchQuery,
  unregisterSubInput,
} = useStoreSubInput({
  isStoreNav: computed(() => activeNav.value === 'store'),
  searchQuery,
})

// Selection state composable
const {
  isStoreNav,
  isSearchMode,
  showScrollableContent,
  selectedCategory,
  selectedPlugin,
} = usePluginMarketSelection({
  activeNav,
  selectedCategoryKey,
  selectedPluginName,
  searchQuery,
  plugins,
  installedViewPlugins,
  storefrontCategories,
})

/**
 * 把当前市场快照与宿主插件状态统一投影到页面响应式状态，并只在最终快照阶段清理失效选择项。
 */
function applyMarketResponse(
  marketResult: PluginMarketFetchResponse,
  nextInstalledPlugins: InstalledPlugin[],
  nextRunningPluginPaths: string[],
  currentPlatform: string,
  nextUpdateHashes: Record<string, string>,
  options: { final: boolean },
): void {
  const viewState = buildMarketViewState(
    marketResult,
    nextInstalledPlugins,
    nextRunningPluginPaths,
    currentPlatform,
    new Map(Object.entries(nextUpdateHashes)),
  )

  plugins.value = viewState.uiPlugins
  installedPlugins.value = nextInstalledPlugins
  installedViewPlugins.value = viewState.installedViewPlugins
  installedUpdateHashes.value = nextUpdateHashes
  runningPluginPaths.value = nextRunningPluginPaths
  storefrontCategories.value = viewState.storefrontCategories
  storefrontSections.value = viewState.storefrontSections
  categoryLayouts.value = viewState.categoryLayouts

  if (!marketResult.success && viewState.uiPlugins.length === 0) {
    loadError.value = '无法连接到商店服务器'
  } else if (viewState.uiPlugins.length > 0 || Object.keys(viewState.storefrontCategories).length > 0) {
    loadError.value = ''
    hasLoadedMarketOnce.value = true
  }

  if (options.final && selectedCategoryKey.value && !viewState.storefrontCategories[selectedCategoryKey.value]) {
    selectedCategoryKey.value = null
  }

  const hasSelectedPlugin = selectedPluginName.value
    ? viewState.uiPlugins.some((plugin) => plugin.name === selectedPluginName.value) ||
      viewState.installedViewPlugins.some((plugin) => plugin.name === selectedPluginName.value)
    : false

  if (options.final && selectedPluginName.value && !hasSelectedPlugin) {
    selectedPluginName.value = null
  }
}

/**
 * 根据流式快照阶段决定是合并旧内容还是收敛最终结果，从而避免刷新过程中的白屏和详情闪退。
 */
function renderMarketSnapshot(
  snapshot: PluginMarketStreamSnapshot,
  nextInstalledPlugins: InstalledPlugin[],
  nextRunningPluginPaths: string[],
  currentPlatform: string,
  nextUpdateHashes: Record<string, string>,
): void {
  latestStreamMarketResponse = snapshot
  const marketResult = snapshot.complete
    ? finalizeMarketSnapshot(snapshot)
    : mergeMarketSnapshots(stableMarketResponse, snapshot)

  applyMarketResponse(marketResult, nextInstalledPlugins, nextRunningPluginPaths, currentPlatform, nextUpdateHashes, {
    final: snapshot.complete,
  })

  if (snapshot.complete) {
    stableMarketResponse = marketResult
  }
}

/**
 * 重新加载插件商店，并在首批流式条目到达后立刻刷新页面；如果刷新失败，则尽量保留已有稳定内容。
 */
async function reloadMarket() {
  const currentPlatform = getCurrentPlatform()
  const sessionId = marketReloadSessionId + 1
  marketReloadSessionId = sessionId
  marketReloadAbortController?.abort()
  const controller = new AbortController()
  marketReloadAbortController = controller

  isLoading.value = !hasLoadedMarketOnce.value
  isRefreshingMarket.value = true
  isMarketStreamActive.value = true
  loadError.value = ''
  latestStreamMarketResponse = null

  let resolvedInstalledPlugins = installedPlugins.value
  let resolvedRunningPluginPaths = runningPluginPaths.value
  let resolvedUpdateHashes = installedUpdateHashes.value

  const installedTask = getInstalledPlugins()
    .then(async (items) => {
      const hashRecords = readMarketInstalledPluginHashes()
      const registryItems = applyMarketInstalledPluginHashes(items, hashRecords)
      const nextUpdateHashes = await loadInstalledUpdateHashes(registryItems, hashRecords)
      if (sessionId !== marketReloadSessionId || controller.signal.aborted) {
        return { items: registryItems, updateHashes: nextUpdateHashes }
      }

      canUseInternalPluginApis.value = true
      resolvedInstalledPlugins = registryItems
      resolvedUpdateHashes = nextUpdateHashes
      if (latestStreamMarketResponse) {
        renderMarketSnapshot(
          latestStreamMarketResponse,
          resolvedInstalledPlugins,
          resolvedRunningPluginPaths,
          currentPlatform,
          resolvedUpdateHashes,
        )
      }
      return { items: registryItems, updateHashes: nextUpdateHashes }
    })
    .catch((error) => {
      if (isPluginHostPermissionDeniedError(error)) {
        canUseInternalPluginApis.value = false
        resolvedInstalledPlugins = []
        resolvedUpdateHashes = {}
        if (sessionId === marketReloadSessionId && latestStreamMarketResponse) {
          renderMarketSnapshot(
            latestStreamMarketResponse,
            resolvedInstalledPlugins,
            resolvedRunningPluginPaths,
            currentPlatform,
            resolvedUpdateHashes,
          )
        }
        return { items: [], updateHashes: {} }
      }

      throw error
    })

  const runningTask = getRunningPlugins()
    .catch((): string[] => [])
    .then((items) => {
      if (sessionId !== marketReloadSessionId || controller.signal.aborted) {
        return items
      }

      resolvedRunningPluginPaths = items
      if (latestStreamMarketResponse) {
        renderMarketSnapshot(
          latestStreamMarketResponse,
          resolvedInstalledPlugins,
          resolvedRunningPluginPaths,
          currentPlatform,
          resolvedUpdateHashes,
        )
      }
      return items
    })

  try {
    const marketTask = streamPluginMarket({
      platform: currentPlatform,
      signal: controller.signal,
      onSnapshot: (snapshot) => {
        if (sessionId !== marketReloadSessionId || controller.signal.aborted) {
          return
        }

        renderMarketSnapshot(
          snapshot,
          resolvedInstalledPlugins,
          resolvedRunningPluginPaths,
          currentPlatform,
          resolvedUpdateHashes,
        )
      },
    }).catch((): PluginMarketFetchResponse => ({
      success: false,
      error: '无法连接到商店服务器',
      data: [],
      storefront: undefined,
    }))

    const [marketResponse, nextInstalledPlugins, nextRunningPluginPaths] = await Promise.all([
      marketTask,
      installedTask,
      runningTask,
    ])

    if (sessionId !== marketReloadSessionId || controller.signal.aborted) {
      return
    }

    if (latestStreamMarketResponse) {
      if (!marketResponse.success) {
        loadError.value = '无法连接到商店服务器'
      }
      return
    }

    if (!marketResponse.success && hasLoadedMarketOnce.value && stableMarketResponse) {
      loadError.value = '无法连接到商店服务器'
      applyMarketResponse(
        stableMarketResponse,
        nextInstalledPlugins.items,
        nextRunningPluginPaths,
        currentPlatform,
        nextInstalledPlugins.updateHashes,
        { final: false },
      )
      return
    }

    applyMarketResponse(
      marketResponse,
      nextInstalledPlugins.items,
      nextRunningPluginPaths,
      currentPlatform,
      nextInstalledPlugins.updateHashes,
      { final: true },
    )
    if (marketResponse.success) {
      stableMarketResponse = marketResponse
    }
  } catch (error) {
    if (controller.signal.aborted || sessionId !== marketReloadSessionId) {
      return
    }

    console.error('[PluginMarket] 加载失败:', error)
    loadError.value = '无法连接到商店服务器'
    if (!hasLoadedMarketOnce.value) {
      plugins.value = []
      installedPlugins.value = []
      installedViewPlugins.value = []
      runningPluginPaths.value = []
      storefrontSections.value = []
      storefrontCategories.value = {}
      categoryLayouts.value = {}
    }
  } finally {
    if (sessionId === marketReloadSessionId) {
      isMarketStreamActive.value = false
      isRefreshingMarket.value = false
      isLoading.value = false
      if (marketReloadAbortController === controller) {
        marketReloadAbortController = null
      }
    }
  }
}

const runtime = usePluginMarketRuntime({
  activeNav,
  selectedPluginName,
  notifyError,
  notifySuccess,
  onAuthChanged: () => Promise.all([
    refreshNotificationsAfterAuthChangeRef(),
    uploadLoadRecords(),
  ]).then(() => {}),
  onReloadMarket: () => reloadMarket(),
  onReloadSelectedPluginDetail: () => reloadSelectedPluginDetailRef(),
})

const {
  shopApiBaseUrl,
  authToken,
  currentUser,
  runtimeConfigLoaded,
  isRestoringSession,
  isLoggingIn,
  isRegistering,
  isUpdatingUsername,
  isUpdatingPassword,
  isUploadingAvatar,
  githubBinding,
  githubDeviceFlow,
  isGithubDeviceFlowBusy,
  currentUserAvatarUrl,
  refreshCurrentUser,
  requireShopLogin,
  handleLogin,
  handleRegister,
  handleGithubLogin,
  handleGithubBind,
  handleOpenGithubVerificationPage,
  handleCancelGithubDeviceFlow,
  handleLogout,
  handleUpdateUsername,
  handleUpdatePassword,
  handleUploadAvatar,
  handleSaveBaseUrl,
} = runtime

const pluginMap = computed(() => new Map(plugins.value.map((plugin) => [plugin.name, plugin])))
const installedPluginMap = computed(
  () => new Map(installedViewPlugins.value.map((plugin) => [plugin.name, plugin])),
)
const canInstallFromMarket = computed(() => canUseInternalPluginApis.value)
const canStopPlugins = computed(() => typeof window.ztools?.internal?.killPlugin === 'function')
const hasStorefront = computed(() => storefrontSections.value.length > 0)
const showBlockingMarketLoading = computed(
  () => isLoading.value && !hasLoadedMarketOnce.value && activeNav.value === 'store',
)
const filteredPlugins = computed(() =>
  weightedSearch(plugins.value, searchQuery.value, [
    { value: (plugin) => plugin.title || plugin.name || '', weight: 10 },
    { value: (plugin) => plugin.description || '', weight: 5 },
  ]),
)

function closePlugin() {
  selectedPluginName.value = null
}

const detail = usePluginMarketDetail({
  selectedPlugin,
  selectedPluginName,
  currentUser,
  requireShopLogin,
  notifyError,
  notifySuccess,
})

const {
  pluginDetailState,
  pluginCommentSubmitSuccessKey,
  pluginCommentTree,
  hasMorePluginComments,
  selectedSourceLabel,
  currentPluginDownloadTarget,
  mergedSelectedPlugin,
  selectPluginDetailVersion,
  resetPluginDetailState,
  reloadSelectedPluginDetail,
  handleLoadMorePluginComments,
  handleSubmitPluginRating,
  handleSubmitPluginComment,
} = detail

reloadSelectedPluginDetailRef = reloadSelectedPluginDetail

const actions = usePluginMarketActions({
  selectedPluginName,
  pluginDetailState,
  currentPluginDownloadTarget,
  canUseInternalPluginApis,
  notifyError,
  notifySuccess,
  confirmAction,
  confirmOpenPluginRisk,
  reloadMarket: () => reloadMarket(),
  openPluginByName,
  closePlugin,
})

const {
  marketBusyPluginName,
  installedBusyPluginName,
  installedBusyAction,
  selectedPluginBusyAction,
  handleOpenPlugin,
  handleInstall,
  handleInstallLatest,
  handleUpgrade,
  handleUninstall,
  handleStopPlugin,
  handleOpenFolder,
} = actions

const notifications = usePluginMarketNotifications({
  activeNav,
  authToken,
  currentUser,
  goToAccount: () => {
    activeNav.value = 'account'
  },
  notifyError,
  notifySuccess,
})

const {
  notificationState,
  unreadNotificationTotal,
  readingNotificationIds,
  notificationTree,
  handleRefreshNotifications,
  handleNotificationFilterChange,
  handleNotificationPageChange,
  openNotification,
  closeNotificationDetail,
  handleMarkAllNotificationsRead,
  handleGoToNotificationLogin,
  refreshNotificationsAfterAuthChange,
  syncNotificationStream,
} = notifications

refreshNotificationsAfterAuthChangeRef = refreshNotificationsAfterAuthChange

const uploads = usePluginMarketUploads({
  authToken,
  currentUser,
  notifyError,
  notifySuccess,
  confirmAction,
  reloadMarket: () => reloadMarket(),
})

const {
  selectedFile: uploadSelectedFile,
  validationError: uploadValidationError,
  hashCheckResult: uploadHashCheckResult,
  isHashing: uploadIsHashing,
  isCheckingHash: uploadIsCheckingHash,
  isUploading: uploadIsUploading,
  uploadProgress,
  uploadStage,
  canUpload: uploadCanUpload,
  uploads: uploadRecords,
  uploadsTotal: uploadRecordsTotal,
  uploadsPage: uploadRecordsPage,
  uploadsLoading: uploadRecordsLoading,
  uploadsError: uploadRecordsError,
  deletingIds: uploadDeletingIds,
  selectFile: uploadSelectFile,
  performUpload: uploadPerformUpload,
  cancelUpload: uploadCancelUpload,
  loadUploads: uploadLoadRecords,
  handleDeleteUpload: uploadHandleDelete,
} = uploads

function handleUploadSelectFile(file: File): void {
  uploadSelectFile(file)
}

function handleUploadClearFile(): void {
  uploadSelectFile(null)
}

function handleUploadOpenPlugin(name: string): void {
  activeNav.value = 'store'
  selectedPluginName.value = name
}

function handleGoToUploadLogin(): void {
  activeNav.value = 'account'
}

// Navigation composable
const {
  handleNavClick: navClick,
  openCategory: navOpenCategory,
  closeCategory: navCloseCategory,
  openPlugin: navOpenPlugin,
} = usePluginMarketNavigation({
  activeNav,
  selectedCategoryKey,
  selectedPluginName,
  canUseInternalPluginApis,
  clearSearchQuery,
  refreshNavData: (nav) => {
    if (nav === 'store' || nav === 'installed') {
      if (isRefreshingMarket.value) {
        return Promise.resolve()
      }
      return reloadMarket()
    }

    if (nav === 'notifications') {
      return handleRefreshNotifications()
    }

    if (nav === 'upload' && authToken.value && currentUser.value) {
      return uploadLoadRecords()
    }

    if (nav === 'account' && authToken.value && currentUser.value) {
      return refreshCurrentUser({ silent: true })
    }

    return Promise.resolve()
  },
})

function handleNavClick(nav: ActiveNav): void {
  navClick(nav)
}

function openCategory(category: StorefrontCategorySummary) {
  navOpenCategory(category.key)
}

function closeCategory() {
  navCloseCategory()
}

function openPlugin(plugin: PluginMarketUiPlugin) {
  navOpenPlugin(plugin.name)
}

function handleSelectPluginDetailVersion(version: PluginDetailVersion): void {
  selectPluginDetailVersion(version)
}

/**
 * 从详情页历史版本入口安装指定构建，并在安装流程结束后刷新当前详情状态。
 */
function handleInstallPluginDetailVersion(version: PluginDetailVersion): void {
  selectPluginDetailVersion(version)
  if (!mergedSelectedPlugin.value) {
    return
  }

  if (mergedSelectedPlugin.value.installed) {
    void handleUpgrade(mergedSelectedPlugin.value).then(() => {
      void reloadSelectedPluginDetailRef()
    })
    return
  }

  void handleInstall(mergedSelectedPlugin.value).then(() => {
    void reloadSelectedPluginDetailRef()
  })
}

const notificationBadgeText = computed(() => {
  if (!currentUser.value) {
    return undefined
  }

  if (unreadNotificationTotal.value > 99) {
    return '99+'
  }

  return String(unreadNotificationTotal.value)
})

const sideNavItems = computed<SideNavItem[]>(() => {
  const items: SideNavItem[] = [
    {
      key: 'store',
      label: '商店',
      badge: plugins.value.length,
    },
    {
      key: 'installed',
      label: '已安装',
      badge: installedViewPlugins.value.length,
      visible: canUseInternalPluginApis.value,
    },
    {
      key: 'upload',
      label: '上传',
    },
    {
      key: 'notifications',
      label: '通知',
      badge: notificationBadgeText.value,
    },
    {
      key: 'account',
      label: '账户',
      badge: currentUser.value ? currentUser.value.username : '未登录',
    },
    {
      key: 'settings',
      label: '设置',
    },
  ]

  return items.filter((item) => item.visible !== false)
})

function handleBannerClick(item: { image: string; url?: string }) {
  if (item.url && typeof window.ztools?.shellOpenExternal === 'function') {
    window.ztools.shellOpenExternal(item.url)
  }
}

function shuffleRandomSection(section: PluginMarketSectionModel): void {
  if (section.type !== 'random') {
    return
  }

  const usedNames = new Set<string>()

  for (const currentSection of storefrontSections.value) {
    if (
      currentSection === section ||
      currentSection.type === 'banner' ||
      currentSection.type === 'navigation'
    ) {
      continue
    }

    for (const plugin of currentSection.plugins || []) {
      usedNames.add(plugin.name)
    }
  }

  const available = plugins.value.filter((plugin) => !usedNames.has(plugin.name))
  section.plugins = shuffleArray(available).slice(0, section.plugins.length)
}

function getCategoryLayout(categoryKey: string): CategoryLayoutSection[] {
  return categoryLayouts.value[categoryKey] || categoryLayouts.value.default || []
}

function handleKeydown(event: KeyboardEvent) {
  const isFindShortcut =
    event.key.toLowerCase() === 'f' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey

  if (isStoreNav.value && isFindShortcut) {
    event.preventDefault()
    event.stopPropagation()
    focusSubInput(true)
    return
  }

  if (event.key !== 'Escape') {
    return
  }

  if (selectedPluginName.value) {
    event.stopPropagation()
    closePlugin()
    return
  }

  if (selectedCategory.value) {
    event.stopPropagation()
    closeCategory()
  }
}

/**
 * 清理授权引导定时器，避免离开组件或授权恢复后误触发。
 */
function clearAuthGuideTimer(): void {
  if (authGuideTimerId !== null) {
    clearTimeout(authGuideTimerId)
    authGuideTimerId = null
  }
}

/**
 * 尝试展示内部 API 授权引导弹窗。
 * 实时检查：未授权、用户未点过"不再弹出"、当前未重复展示。
 */
function tryShowInternalApiAuthGuide(): void {
  if (
    canUseInternalPluginApis.value === false &&
    !hasDismissedInternalApiAuthGuide.value &&
    !internalApiAuthGuideVisible.value
  ) {
    openInternalApiAuthGuide()
  }
}

/**
 * 调度授权引导弹窗：风险提示关闭后延迟 1 秒展示。
 * 每次调度前先清理旧定时器，避免重复定时器叠加。
 */
function scheduleAuthGuide(): void {
  clearAuthGuideTimer()
  authGuideTimerId = setTimeout(() => {
    authGuideTimerId = null
    tryShowInternalApiAuthGuide()
  }, 1000)
}

/**
 * 复制插件名称到剪贴板。
 */
async function copyPluginName(): Promise<void> {
  try {
    await navigator.clipboard.writeText(pluginName)
    showSuccessToast('已复制到剪贴板')
  } catch (error) {
    console.error('[BadBear] Failed to copy plugin name:', error)
    showErrorToast('复制失败，请手动复制')
  }
}

/**
 * 处理"我知道了"按钮，本次关闭授权引导但不持久化偏好。
 */
function handleAuthGuideClose(): void {
  closeInternalApiAuthGuide()
}

/**
 * 处理"不再弹出"按钮，关闭并持久化"不再弹出"偏好。
 */
function handleAuthGuideDismiss(): void {
  dismissInternalApiAuthGuide()
}

watch(
  () => selectedPlugin.value?.name,
  (pluginName) => {
    if (!pluginName) {
      resetPluginDetailState()
      return
    }

    void reloadSelectedPluginDetail()
  },
)

watch(canUseInternalPluginApis, (enabled) => {
  if (!enabled && activeNav.value === 'installed') {
    activeNav.value = 'store'
    selectedPluginName.value = null
  }

  // 授权恢复时，取消未触发的定时器并关闭引导，不写入"不再弹出"
  if (enabled) {
    clearAuthGuideTimer()
    if (internalApiAuthGuideVisible.value) {
      closeInternalApiAuthGuide()
    }
  }
})

watch(searchQuery, (query) => {
  if (!query.trim()) {
    return
  }

  selectedCategoryKey.value = null
})

watch(activeNav, (nav) => {
  if (nav === 'installed') {
    selectedCategoryKey.value = null
    clearSearchQuery()

    if (!canUseInternalPluginApis.value) {
      return
    }

    if (selectedPluginName.value && !installedPluginMap.value.has(selectedPluginName.value)) {
      selectedPluginName.value = null
    }
  } else if (nav === 'store') {
    if (selectedPluginName.value && !pluginMap.value.has(selectedPluginName.value)) {
      selectedPluginName.value = null
    }
  } else {
    selectedCategoryKey.value = null
    selectedPluginName.value = null
    clearSearchQuery()
  }

  syncStoreSubInput()
  syncNotificationStream()

  if (nav === 'store' || nav === 'installed') {
    if (!isRefreshingMarket.value) {
      void reloadMarket()
    }
  } else if (nav === 'notifications') {
    void handleRefreshNotifications()
  } else if (nav === 'upload' && authToken.value && currentUser.value) {
    void uploadLoadRecords()
  } else if (nav === 'account' && authToken.value && currentUser.value) {
    void refreshCurrentUser({ silent: true })
  }
})

onMounted(() => {
  syncNotificationStream()
  syncStoreSubInput()
  void reloadMarket()

  // 立即检查并弹出风险提示，不依赖 onPluginEnter 事件
  if (!hasDismissedMarketRiskDialog.value) {
    void openMarketRiskDialog().then((confirmed) => {
      if (confirmed) {
        scheduleAuthGuide()
      }
    })
  } else {
    scheduleAuthGuide()
  }

  // 也监听 onPluginEnter 事件，以防有其他场景需要
  window.ztools.onPluginEnter(() => {
    if (!hasDismissedMarketRiskDialog.value) {
      void openMarketRiskDialog().then((confirmed) => {
        if (confirmed) {
          scheduleAuthGuide()
        }
      })
    } else {
      scheduleAuthGuide()
    }
  })

  window.addEventListener('keydown', handleKeydown, true)
})

onUnmounted(() => {
  marketReloadAbortController?.abort()
  unregisterSubInput()
  clearAuthGuideTimer()
  window.removeEventListener('keydown', handleKeydown, true)
})
</script>

<template>
  <div class="plugin-market">
    <ZModal
      :show="marketRiskDialogState.visible"
      to="body"
      :mask-closable="false"
      :close-on-esc="false"
      @update:show="handleMarketRiskVisibleChange"
    >
      <div class="market-risk-modal" role="dialog" aria-modal="true" :aria-label="marketRiskDialogState.title">
        <div class="market-risk-modal__header">
          <h3 class="market-risk-modal__title">{{ marketRiskDialogState.title }}</h3>
        </div>
        <div class="market-risk-modal__body">
          <div class="market-risk-modal__type">请逐项确认以下风险后继续：</div>
          <div class="market-risk-modal__checklist">
            <ZCheckbox
              v-for="item in marketRiskDialogState.items"
              :key="item.key"
              :model-value="item.checked"
              @update:model-value="updateMarketRiskChecklistItem(item.key, $event)"
            >
              {{ item.label }}
            </ZCheckbox>
          </div>
        </div>
        <div class="market-risk-modal__footer">
          <div class="market-risk-modal__actions">
            <ZButton :disabled="!canSubmitMarketRiskDialog" @click="handleMarketRiskCancel">
              {{ marketRiskDialogState.cancelText }}
            </ZButton>
            <ZButton type="primary" :disabled="!canSubmitMarketRiskDialog" @click="handleMarketRiskConfirm">
              {{ marketRiskDialogState.confirmText }}
            </ZButton>
          </div>
        </div>
      </div>
    </ZModal>

    <ZModal
      :show="internalApiAuthGuideVisible"
      to="body"
      :mask-closable="true"
      :close-on-esc="true"
      @update:show="internalApiAuthGuideVisible = $event"
    >
      <div class="auth-guide-modal" role="dialog" aria-modal="true" aria-label="内部 API 授权引导">
        <div class="auth-guide-modal__header">
          <h3 class="auth-guide-modal__title">需要授权内部 API</h3>
        </div>
        <div class="auth-guide-modal__body">
          <img :src="authGuideImage" alt="授权引导" class="auth-guide-modal__image" />
          <div class="auth-guide-modal__instruction">
            <div class="auth-guide-modal__text">
              请到 ZTools 设置页下滑到"内部API授权插件"处，输入并添加以下插件名称：
            </div>
            <div class="auth-guide-modal__plugin-name-block">
              <code class="auth-guide-modal__plugin-name">{{ pluginName }}</code>
              <ZButton size="small" @click="copyPluginName">复制</ZButton>
            </div>
            <div class="auth-guide-modal__text">
              授权后重新打开插件即可正常使用。
            </div>
          </div>
        </div>
        <div class="auth-guide-modal__footer">
          <div class="auth-guide-modal__actions">
            <ZButton @click="handleAuthGuideClose">我知道了</ZButton>
            <ZButton type="primary" @click="handleAuthGuideDismiss">不再弹出</ZButton>
          </div>
        </div>
      </div>
    </ZModal>

    <aside class="side-nav">
      <div class="side-nav-header">
        <div class="side-nav-subtitle">你需要有独当一面的能力<br>才能避免引火烧身</div>
      </div>

      <div class="side-nav-list">
        <div
          v-for="item in sideNavItems"
          :key="item.key"
          class="side-nav-item"
          :class="{ active: activeNav === item.key }"
          @click="handleNavClick(item.key)"
        >
          <span class="side-nav-item-label">{{ item.label }}</span>
          <span v-if="item.badge !== undefined" class="side-nav-count">{{ item.badge }}</span>
        </div>
      </div>

      <div class="side-nav-footer">
        <div v-if="currentUser" class="side-nav-user">
          <img v-if="currentUserAvatarUrl" :src="currentUserAvatarUrl" alt="头像" class="side-nav-avatar" />
          <div v-else class="side-nav-avatar side-nav-avatar--fallback">
            {{ (currentUser.username || currentUser.account).slice(0, 1).toUpperCase() }}
          </div>
          <div class="side-nav-user-copy">
            <div class="side-nav-user-name">{{ currentUser.username }}</div>
            <div class="side-nav-user-account">{{ currentUser.account }}</div>
          </div>
        </div>
      </div>
    </aside>

    <div class="content-shell">
      <div class="content-body">
        <Transition name="list-slide">
          <div v-show="showScrollableContent" class="scrollable-content">
            <div v-if="showBlockingMarketLoading" class="loading-state">
              <div class="loading-spinner"></div>
              <span>加载中...</span>
            </div>

            <template v-else-if="activeNav === 'store'">
              <div v-if="isRefreshingMarket" class="market-refresh-indicator">
                <div class="loading-spinner market-refresh-spinner"></div>
                <span>{{ isMarketStreamActive ? '商店内容更新中…' : '正在整理商店内容…' }}</span>
              </div>

              <template v-if="isSearchMode">
                <div v-if="filteredPlugins.length === 0" class="empty-state">
                  <svg
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" />
                    <path
                      d="M16 16L20 20"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                    />
                  </svg>
                  <span>未找到匹配的插件</span>
                </div>
                <div v-else class="market-grid">
                  <PluginCard
                    v-for="plugin in filteredPlugins"
                    :key="plugin.name"
                    :plugin="plugin"
                    :installing-plugin="marketBusyPluginName"
                    :can-install-from-market="canInstallFromMarket"
                    @click="openPlugin(plugin)"
                    @open="handleOpenPlugin(plugin)"
                    @download="handleInstall(plugin)"
                  />
                </div>
              </template>

              <template v-else-if="hasStorefront">
                <div class="storefront">
                  <template v-for="section in storefrontSections" :key="section.key">
                    <div v-if="section.type === 'banner'" class="storefront-banner">
                      <div
                        v-for="(item, idx) in section.items"
                        :key="idx"
                        class="banner-item"
                        :class="{ clickable: !!item.url }"
                        :style="section.height ? { height: `${section.height}px` } : undefined"
                        @click="handleBannerClick(item)"
                      >
                        <img :src="item.image" alt="" class="banner-image" draggable="false" />
                      </div>
                    </div>

                    <div v-else-if="section.type === 'navigation'" class="storefront-section">
                      <div v-if="section.title" class="section-header">
                        <span class="section-title">{{ section.title }}</span>
                      </div>
                      <div class="navigation-grid">
                        <CategoryCard
                          v-for="cat in section.categories"
                          :key="cat.key"
                          :title="cat.title"
                          :description="cat.description"
                          :icon="cat.icon"
                          :show-description="cat.showDescription"
                          :plugin-count="cat.pluginCount"
                          @click="openCategory(cat)"
                        />
                      </div>
                    </div>

                    <div
                      v-else-if="section.type === 'fixed' || section.type === 'random'"
                      class="storefront-section"
                    >
                      <div v-if="section.title || section.type === 'random'" class="section-header">
                        <span v-if="section.title" class="section-title">{{ section.title }}</span>
                        <RefreshButton
                          v-if="section.type === 'random'"
                          @click="shuffleRandomSection(section)"
                        />
                      </div>
                      <div class="market-grid">
                        <PluginCard
                          v-for="plugin in section.plugins"
                          :key="plugin.name"
                          :plugin="plugin"
                          :installing-plugin="marketBusyPluginName"
                          :can-install-from-market="canInstallFromMarket"
                          @click="openPlugin(plugin)"
                          @open="handleOpenPlugin(plugin)"
                          @download="handleInstall(plugin)"
                        />
                      </div>
                    </div>
                  </template>
                </div>
              </template>

              <template v-else>
                <div v-if="plugins.length === 0 && !loadError" class="empty-state">
                  <svg
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" />
                    <path
                      d="M16 16L20 20"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                    />
                  </svg>
                  <span>暂无插件</span>
                </div>
                <div v-else-if="loadError" class="empty-state">
                  <span>{{ loadError }}</span>
                  <ZButton class="retry-btn" @click="reloadMarket">重试</ZButton>
                </div>
                <div v-else class="market-grid">
                  <PluginCard
                    v-for="plugin in plugins"
                    :key="plugin.name"
                    :plugin="plugin"
                    :installing-plugin="marketBusyPluginName"
                    :can-install-from-market="canInstallFromMarket"
                    @click="openPlugin(plugin)"
                    @open="handleOpenPlugin(plugin)"
                    @download="handleInstall(plugin)"
                  />
                </div>
              </template>
            </template>

            <template v-else>
              <div v-if="installedViewPlugins.length === 0" class="empty-state">
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" stroke-width="2" />
                  <path d="M8 12H16" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                </svg>
                <span>暂无已安装插件</span>
              </div>
              <div v-else class="installed-list">
                <InstalledPluginCard
                  v-for="plugin in installedViewPlugins"
                  :key="plugin.path"
                  :plugin="plugin"
                  :busy-action="installedBusyPluginName === plugin.name ? installedBusyAction : null"
                  :is-internal="isInternalPlugin(plugin.name)"
                  :can-stop="canStopPlugins"
                  @click="openPlugin(plugin)"
                  @open="handleOpenPlugin(plugin)"
                  @open-folder="handleOpenFolder(plugin)"
                  @upgrade="handleUpgrade(plugin)"
                  @stop="handleStopPlugin(plugin)"
                  @uninstall="handleUninstall(plugin)"
                />
              </div>
            </template>
          </div>
        </Transition>

        <div v-if="activeNav === 'account'" class="panel-view scrollable-panel account-scroll">
          <AccountPanel
            :current-user="currentUser"
            :avatar-url="currentUserAvatarUrl"
            :is-restoring-session="runtimeConfigLoaded && isRestoringSession"
            :is-logging-in="isLoggingIn"
            :is-registering="isRegistering"
            :is-updating-username="isUpdatingUsername"
            :is-updating-password="isUpdatingPassword"
            :is-uploading-avatar="isUploadingAvatar"
            :github-binding="githubBinding"
            :github-device-flow="githubDeviceFlow"
            :is-github-device-flow-busy="isGithubDeviceFlowBusy"
            @login="handleLogin"
            @register="handleRegister"
            @github-login="handleGithubLogin"
            @github-bind="handleGithubBind"
            @github-open-verification="handleOpenGithubVerificationPage"
            @github-cancel-device-flow="handleCancelGithubDeviceFlow"
            @logout="handleLogout"
            @update-username="handleUpdateUsername"
            @update-password="handleUpdatePassword"
            @upload-avatar="handleUploadAvatar"
          />
        </div>

        <div v-else-if="activeNav === 'upload'" class="panel-view scrollable-panel">
          <PluginUploadPanel
            :current-user="currentUser"
            :selected-file="uploadSelectedFile"
            :validation-error="uploadValidationError"
            :hash-check-result="uploadHashCheckResult"
            :is-hashing="uploadIsHashing"
            :is-checking-hash="uploadIsCheckingHash"
            :is-uploading="uploadIsUploading"
            :upload-progress="uploadProgress"
            :upload-stage="uploadStage"
            :can-upload="uploadCanUpload"
            :uploads="uploadRecords"
            :uploads-total="uploadRecordsTotal"
            :uploads-page="uploadRecordsPage"
            :uploads-loading="uploadRecordsLoading"
            :uploads-error="uploadRecordsError"
            :deleting-ids="uploadDeletingIds"
            @select-file="handleUploadSelectFile"
            @clear-file="handleUploadClearFile"
            @upload="uploadPerformUpload"
            @cancel-upload="uploadCancelUpload"
            @refresh-uploads="uploadLoadRecords"
            @delete-upload="uploadHandleDelete"
            @open-plugin="handleUploadOpenPlugin"
            @go-login="handleGoToUploadLogin"
          />
        </div>

        <div v-else-if="activeNav === 'notifications'" class="panel-view scrollable-panel">
          <NotificationPanel
            :items="notificationTree"
            :loading="notificationState.loading"
            :error="notificationState.error"
            :filter="notificationState.filter"
            :page="notificationState.page"
            :page-size="notificationState.pageSize"
            :total="notificationState.total"
            :unread-total="unreadNotificationTotal"
            :selected-id="notificationState.selectedId"
            :selected-item="notificationState.selectedItem"
            :reading-ids="readingNotificationIds"
            :marking-all-read="notificationState.markingAllRead"
            :current-user="currentUser"
            @change-filter="handleNotificationFilterChange"
            @change-page="handleNotificationPageChange"
            @open-item="openNotification"
            @close-detail="closeNotificationDetail"
            @mark-all-read="handleMarkAllNotificationsRead"
            @go-login="handleGoToNotificationLogin"
            @refresh="handleRefreshNotifications"
          />
        </div>

        <div v-else-if="activeNav === 'settings'" class="panel-view scrollable-panel">
          <ApiSettingsPanel
            :base-url="shopApiBaseUrl"
            @save="handleSaveBaseUrl"
          />
        </div>

        <Transition name="slide">
          <div
            v-if="selectedCategory"
            class="category-panel-container"
            :class="{ 'shifted-left': !!selectedPlugin }"
          >
            <CategoryDetail
              :category="selectedCategory"
              :layout="getCategoryLayout(selectedCategory.key)"
              :installing-plugin-name="marketBusyPluginName"
              :plugin-map="pluginMap"
              :can-install-from-market="canInstallFromMarket"
              @back="closeCategory"
              @click-plugin="openPlugin"
              @open-plugin="handleOpenPlugin"
              @download-plugin="handleInstall"
            />
          </div>
        </Transition>

        <Transition name="slide">
          <PluginDetail
            v-if="mergedSelectedPlugin"
            :plugin="mergedSelectedPlugin"
            :busy-action="selectedPluginBusyAction"
            :is-running="!!mergedSelectedPlugin.isRunning"
            :can-stop="canStopPlugins"
            :is-logged-in="!!currentUser"
            :is-internal="isInternalPlugin(mergedSelectedPlugin.name)"
            :can-install-from-market="canInstallFromMarket"
            :avg-rating="pluginDetailState.detail?.avgRating"
            :rating-count="pluginDetailState.detail?.ratingCount"
            :current-user-rating="pluginDetailState.currentUserRating?.score"
            :comments="pluginCommentTree"
            :comments-loading="pluginDetailState.commentLoading"
            :comments-loading-more="pluginDetailState.commentLoadingMore"
            :comments-error="pluginDetailState.commentError"
            :has-more-comments="hasMorePluginComments"
            :rating-submitting="pluginDetailState.ratingSubmitting"
            :comment-submitting="pluginDetailState.commentSubmitting"
            :current-user-avatar-url="currentUserAvatarUrl"
            :comment-submit-success-key="pluginCommentSubmitSuccessKey"
            :versions="pluginDetailState.detail?.versions || []"
            :selected-version="pluginDetailState.selectedVersion"
            :selected-hash="pluginDetailState.selectedHash"
            :remote-readme="pluginDetailState.detail?.readme ?? null"
            :source-label="selectedSourceLabel"
            :risk="pluginDetailState.risk"
            :risk-loading="pluginDetailState.riskLoading"
            :risk-error="pluginDetailState.riskError"
            @back="closePlugin"
            @open="handleOpenPlugin(mergedSelectedPlugin)"
            @download="handleInstall(mergedSelectedPlugin)"
            @install-latest="handleInstallLatest(mergedSelectedPlugin)"
            @upgrade="handleUpgrade(mergedSelectedPlugin)"
            @uninstall="handleUninstall(mergedSelectedPlugin)"
            @open-folder="handleOpenFolder(mergedSelectedPlugin)"
            @stop="handleStopPlugin(mergedSelectedPlugin)"
            @select-version="handleSelectPluginDetailVersion"
            @install-version="handleInstallPluginDetailVersion"
            @submit-rating="handleSubmitPluginRating"
            @submit-comment="handleSubmitPluginComment"
            @load-more-comments="handleLoadMorePluginComments"
          />
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
.plugin-market {
  display: flex;
  height: 100%;
  min-height: 0;
}

.side-nav {
  display: flex;
  flex-direction: column;
  width: 200px;
  border-right: 1px solid var(--divider-color);
  padding: 12px 8px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.side-nav-header {
  padding: 6px 8px 14px;
}

.side-nav-title {
  color: var(--text-color);
  font-size: 18px;
  font-weight: 700;
}

.side-nav-subtitle {
  margin-top: 6px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.side-nav-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  padding: 0 4px;
  overflow-y: auto;
}

.side-nav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  color: var(--text-color);
  text-align: left;
  transition: all 0.2s;
}

.side-nav-item:hover {
  background: var(--hover-bg);
}

.side-nav-item.active {
  background: var(--active-bg);
  color: var(--primary-color);
  font-weight: 500;
}

.side-nav-item-label {
  min-width: 0;
  font-size: 14px;
  font-weight: inherit;
}

.side-nav-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  max-width: 120px;
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 14%, transparent);
  font-size: 11px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.side-nav-footer {
  margin-top: auto;
  padding: 12px 8px 4px;
}

.side-nav-user {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.side-nav-avatar {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--surface-elevated);
}

.side-nav-avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--primary-color);
  font-size: 16px;
  font-weight: 700;
}

.side-nav-user-copy {
  min-width: 0;
}

.side-nav-user-name,
.side-nav-user-account,
.side-nav-guest {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.side-nav-user-name {
  color: var(--text-color);
  font-size: 13px;
  font-weight: 700;
}

.side-nav-user-account,
.side-nav-guest {
  color: var(--text-secondary);
  font-size: 11px;
}

.market-risk-modal {
  width: min(560px, calc(100vw - 32px));
  border-radius: 16px;
  background: var(--surface-color, var(--bg-color));
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.24);
  color: var(--text-color);
  overflow: hidden;
}

.market-risk-modal__header {
  padding: 20px 20px 12px;
  border-bottom: 1px solid var(--divider-color);
}

.market-risk-modal__title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.market-risk-modal__body {
  padding: 16px 20px;
}

.market-risk-modal__type {
  margin-bottom: 12px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.market-risk-modal__checklist {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.market-risk-modal__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px 20px;
  border-top: 1px solid var(--divider-color);
}

.market-risk-modal__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}

.auth-guide-modal {
  width: min(600px, calc(100vw - 32px));
  max-height: 90vh;
  border-radius: 16px;
  background: var(--surface-color, var(--bg-color));
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.24);
  color: var(--text-color);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.auth-guide-modal__header {
  flex-shrink: 0;
  padding: 20px 20px 12px;
  border-bottom: 1px solid var(--divider-color);
}

.auth-guide-modal__title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.auth-guide-modal__body {
  flex: 1;
  min-height: 0;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}

.auth-guide-modal__image {
  width: 100%;
  border-radius: 8px;
  border: 1px solid var(--divider-color);
}

.auth-guide-modal__instruction {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  border: 2px solid var(--divider-color);
  border-radius: 8px;
  background: var(--surface-elevated, var(--hover-bg));
}

.auth-guide-modal__text {
  color: var(--text-color);
  font-size: 14px;
  line-height: 1.6;
}

.auth-guide-modal__plugin-name-block {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 2px solid var(--divider-color);
  border-radius: 8px;
  background: var(--bg-color);
}

.auth-guide-modal__plugin-name {
  flex: 1;
  font-family: 'Courier New', Courier, monospace;
  font-size: 14px;
  font-weight: 600;
  color: var(--primary-color);
}

.auth-guide-modal__footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px 20px;
  border-top: 1px solid var(--divider-color);
}

.auth-guide-modal__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}


.content-shell {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.content-body {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.scrollable-content,
.scrollable-panel {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
  background: var(--bg-color);
}

.panel-view {
  position: absolute;
  inset: 0;
}

.account-scroll {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.content-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px;
  margin-bottom: 20px;
}

.content-eyebrow {
  display: inline-flex;
  margin-bottom: 8px;
  color: var(--primary-color);
  font-size: 12px;
  font-weight: 700;
}

.content-title {
  margin: 0;
  color: var(--text-color);
  font-size: 22px;
}

.content-description {
  margin: 8px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.retry-btn {
  flex-shrink: 0;
}

/* 列表滑动动画 - 已禁用 */
.list-slide-enter-active,
.list-slide-leave-active {
  transition: none !important;
}

.list-slide-enter-from,
.list-slide-enter-to,
.list-slide-leave-from,
.list-slide-leave-to {
  transform: translateX(0) !important;
  opacity: 1 !important;
}

.slide-enter-active {
  transition:
    transform 0.2s ease-out,
    opacity 0.15s ease;
}

.slide-leave-active {
  transition:
    transform 0.2s ease-in,
    opacity 0.15s ease;
}

.slide-enter-from {
  transform: translateX(100%);
  opacity: 0;
}

.slide-enter-to {
  transform: translateX(0);
  opacity: 1;
}

.slide-leave-from {
  transform: translateX(0);
  opacity: 1;
}

.slide-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

.storefront {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.storefront-banner {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.banner-item {
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  align-items: center;
}

.banner-item.clickable {
  cursor: pointer;
}

.banner-item.clickable:hover {
  opacity: 0.92;
}

.banner-image {
  width: 100%;
  height: 100%;
  display: block;
  border-radius: 12px;
  object-fit: cover;
}

.storefront-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color);
}

.category-panel-container {
  position: absolute;
  inset: 0;
  z-index: 10;
  background: var(--bg-color);
  transition: transform 0.2s ease-out;
}

.category-panel-container.shifted-left {
  transform: translateX(-100%);
}

.navigation-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.market-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.installed-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 240px;
  gap: 12px;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--divider-color);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.loading-state span {
  font-size: 13px;
  color: var(--text-secondary);
}

.market-refresh-indicator {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  color: var(--text-secondary);
  font-size: 12px;
}

.market-refresh-spinner {
  width: 14px;
  height: 14px;
  border-width: 2px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 240px;
  gap: 12px;
  color: var(--text-secondary);
  text-align: center;
}

.empty-state svg {
  opacity: 0.4;
}

.empty-state span {
  font-size: 13px;
}

.retry-btn {
  background: var(--primary-color);
  border-color: var(--primary-color);
  color: var(--text-on-primary);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 960px) {
  .side-nav {
    width: 200px;
    min-width: 200px;
    padding: 16px 12px;
  }

  .content-hero {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
