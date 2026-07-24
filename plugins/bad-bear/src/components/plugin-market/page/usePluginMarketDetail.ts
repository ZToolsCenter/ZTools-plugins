import { computed, ref, type ComputedRef, type Ref } from 'vue'
import {
  createPluginComment,
  createPluginRating,
  getPluginComments,
  getPluginDetail,
  getPluginRatings,
  getPluginRisk,
} from '../../../api/pluginMarket'
import type { AuthUser } from '../../../types/auth'
import type {
  PluginDetailVersion,
  PluginMarketUiPlugin,
  PluginRiskInfo,
  ResolvedPluginDownloadTarget,
} from '../../../types/pluginMarket'
import {
  buildCommentTree,
  buildCurrentPluginDownloadTarget,
  createEmptyPluginDetailState,
  getErrorMessage,
  mapPluginSourceLabel,
  mergePluginDetailIntoPlugin,
  parsePluginSourceReference,
} from './shared'

export function usePluginMarketDetail(options: {
  selectedPlugin: ComputedRef<PluginMarketUiPlugin | null>
  selectedPluginName: Ref<string | null>
  currentUser: Ref<AuthUser | null>
  requireShopLogin: (actionLabel: string) => boolean
  notifyError: (message: string) => void
  notifySuccess: (message: string) => void
}) {
  const pluginDetailState = ref(createEmptyPluginDetailState())
  const pluginCommentSubmitSuccessKey = ref(0)

  const pluginCommentTree = computed(() => buildCommentTree(pluginDetailState.value.comments))
  const selectedSourceLabel = computed(() =>
    mapPluginSourceLabel(parsePluginSourceReference(pluginDetailState.value.detail?.source)),
  )
  const hasMorePluginComments = computed(
    () => pluginDetailState.value.comments.length < pluginDetailState.value.commentTotal,
  )
  const selectedPluginDetailVersion = computed<PluginDetailVersion | null>(() => {
    const detail = pluginDetailState.value.detail
    const selectedVersion = pluginDetailState.value.selectedVersion
    const selectedHash = pluginDetailState.value.selectedHash
    if (!detail || !selectedVersion || !selectedHash) {
      return null
    }

    return (
      detail.versions.find(
        (version) => version.version === selectedVersion && version.hash === selectedHash,
      ) || null
    )
  })
  const currentPluginDownloadTarget = computed<ResolvedPluginDownloadTarget | null>(() =>
    buildCurrentPluginDownloadTarget(
      options.selectedPlugin.value,
      pluginDetailState.value.detail,
      selectedPluginDetailVersion.value,
    ),
  )
  const mergedSelectedPlugin = computed(() => {
    if (!options.selectedPlugin.value) {
      return null
    }

    return mergePluginDetailIntoPlugin(
      options.selectedPlugin.value,
      pluginDetailState.value.detail,
      currentPluginDownloadTarget.value,
    )
  })

  async function loadPluginDetail(name: string, requestId: number): Promise<void> {
    const detail = await getPluginDetail(name)
    if (
      pluginDetailState.value.requestId !== requestId ||
      options.selectedPluginName.value !== name
    ) {
      return
    }

    pluginDetailState.value.detail = detail

    const selectedVersion = pluginDetailState.value.selectedVersion
    const selectedHash = pluginDetailState.value.selectedHash
    if (!selectedVersion || !selectedHash) {
      return
    }

    const hasSelectedVersion = detail.versions.some(
      (version) => version.version === selectedVersion && version.hash === selectedHash,
    )
    if (!hasSelectedVersion) {
      pluginDetailState.value.selectedVersion = null
      pluginDetailState.value.selectedHash = null
    }
  }

  async function loadPluginRisk(
    name: string,
    requestId: number,
    version?: string | null,
  ): Promise<void> {
    pluginDetailState.value.riskLoading = true
    pluginDetailState.value.riskError = ''

    try {
      const risk: PluginRiskInfo = await getPluginRisk(name, version)
      if (
        pluginDetailState.value.requestId !== requestId ||
        options.selectedPluginName.value !== name
      ) {
        return
      }

      pluginDetailState.value.risk = risk
      pluginDetailState.value.riskError = ''
    } catch (error) {
      if (
        pluginDetailState.value.requestId !== requestId ||
        options.selectedPluginName.value !== name
      ) {
        return
      }

      pluginDetailState.value.risk = null
      pluginDetailState.value.riskError = getErrorMessage(error, '加载风险信息失败')
    } finally {
      if (
        pluginDetailState.value.requestId !== requestId ||
        options.selectedPluginName.value !== name
      ) {
        return
      }

      pluginDetailState.value.riskLoading = false
    }
  }

  async function loadCurrentUserPluginRating(name: string, requestId: number): Promise<void> {
    if (!options.currentUser.value) {
      if (
        pluginDetailState.value.requestId === requestId &&
        options.selectedPluginName.value === name
      ) {
        pluginDetailState.value.currentUserRating = null
      }
      return
    }

    try {
      const response = await getPluginRatings(name, { page: 1, pageSize: 100 })
      if (
        pluginDetailState.value.requestId !== requestId ||
        options.selectedPluginName.value !== name
      ) {
        return
      }

      pluginDetailState.value.currentUserRating =
        response.items.find((item) => item.user.id === options.currentUser.value?.id) || null
    } catch (error) {
      if (
        pluginDetailState.value.requestId !== requestId ||
        options.selectedPluginName.value !== name
      ) {
        return
      }

      console.warn('[PluginMarket] 加载当前用户评分失败:', error)
      pluginDetailState.value.currentUserRating = null
    }
  }

  async function loadPluginComments(
    name: string,
    requestId: number,
    params: { page?: number; append?: boolean } = {},
  ): Promise<void> {
    const page = params.page ?? 1
    const append = params.append ?? false

    if (append) {
      pluginDetailState.value.commentLoadingMore = true
    } else {
      pluginDetailState.value.commentLoading = true
      pluginDetailState.value.commentError = ''
    }

    try {
      const response = await getPluginComments(name, {
        page,
        pageSize: pluginDetailState.value.commentPageSize,
      })

      if (
        pluginDetailState.value.requestId !== requestId ||
        options.selectedPluginName.value !== name
      ) {
        return
      }

      const nextItems = append
        ? [...pluginDetailState.value.comments, ...response.items].filter(
            (item, index, list) =>
              list.findIndex((current) => current.id === item.id) === index,
          )
        : response.items

      pluginDetailState.value.comments = nextItems
      pluginDetailState.value.commentPage = response.page
      pluginDetailState.value.commentPageSize = response.pageSize
      pluginDetailState.value.commentTotal = response.total
      pluginDetailState.value.commentError = ''
    } catch (error) {
      if (
        pluginDetailState.value.requestId !== requestId ||
        options.selectedPluginName.value !== name
      ) {
        return
      }

      pluginDetailState.value.commentError = getErrorMessage(error, '加载评论失败')
    } finally {
      if (
        pluginDetailState.value.requestId !== requestId ||
        options.selectedPluginName.value !== name
      ) {
        return
      }

      pluginDetailState.value.commentLoading = false
      pluginDetailState.value.commentLoadingMore = false
    }
  }

  function resetPluginDetailState(): void {
    pluginDetailState.value = createEmptyPluginDetailState()
  }

  async function reloadSelectedPluginDetail(): Promise<void> {
    if (!options.selectedPlugin.value) {
      resetPluginDetailState()
      return
    }

    const pluginName = options.selectedPlugin.value.name
    const requestId = pluginDetailState.value.requestId + 1
    pluginDetailState.value = {
      ...createEmptyPluginDetailState(),
      requestId,
      commentLoading: true,
    }

    try {
      await loadPluginDetail(pluginName, requestId)
      await Promise.all([
        loadCurrentUserPluginRating(pluginName, requestId),
        loadPluginComments(pluginName, requestId),
        loadPluginRisk(
          pluginName,
          requestId,
          pluginDetailState.value.detail?.version || options.selectedPlugin.value.version,
        ),
      ])
    } catch (error) {
      console.error('[PluginMarket] 加载插件详情交互数据失败:', error)
    }
  }

  function selectPluginDetailVersion(version: PluginDetailVersion): void {
    pluginDetailState.value.selectedVersion = version.version
    pluginDetailState.value.selectedHash = version.hash
  }

  async function handleLoadMorePluginComments(): Promise<void> {
    if (
      !options.selectedPlugin.value ||
      pluginDetailState.value.commentLoadingMore ||
      !hasMorePluginComments.value
    ) {
      return
    }

    await loadPluginComments(
      options.selectedPlugin.value.name,
      pluginDetailState.value.requestId,
      {
        page: pluginDetailState.value.commentPage + 1,
        append: true,
      },
    )
  }

  async function handleSubmitPluginRating(score: number): Promise<void> {
    if (!options.selectedPlugin.value || pluginDetailState.value.ratingSubmitting) {
      return
    }

    if (!options.requireShopLogin('评分')) {
      return
    }

    pluginDetailState.value.ratingSubmitting = true

    try {
      await createPluginRating(options.selectedPlugin.value.name, { score })
      options.notifySuccess('评分成功')
      await Promise.all([
        loadPluginDetail(options.selectedPlugin.value.name, pluginDetailState.value.requestId),
        loadCurrentUserPluginRating(
          options.selectedPlugin.value.name,
          pluginDetailState.value.requestId,
        ),
      ])
    } catch (error) {
      console.error('[PluginMarket] 提交评分失败:', error)
      options.notifyError(getErrorMessage(error, '提交评分失败'))
    } finally {
      pluginDetailState.value.ratingSubmitting = false
    }
  }

  async function handleSubmitPluginComment(payload: {
    content: string
    parentId?: string
  }): Promise<void> {
    if (!options.selectedPlugin.value || pluginDetailState.value.commentSubmitting) {
      return
    }

    if (!options.requireShopLogin(payload.parentId ? '回复评论' : '发表评论')) {
      return
    }

    pluginDetailState.value.commentSubmitting = true

    try {
      await createPluginComment(options.selectedPlugin.value.name, payload)
      options.notifySuccess(payload.parentId ? '回复成功' : '评论成功')
      pluginCommentSubmitSuccessKey.value += 1
      await loadPluginComments(
        options.selectedPlugin.value.name,
        pluginDetailState.value.requestId,
      )
    } catch (error) {
      console.error('[PluginMarket] 提交评论失败:', error)
      options.notifyError(getErrorMessage(error, '提交评论失败'))
    } finally {
      pluginDetailState.value.commentSubmitting = false
    }
  }

  return {
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
  }
}
