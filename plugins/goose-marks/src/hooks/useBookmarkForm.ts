import { useCallback, useEffect, useMemo, useRef } from 'react'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { Bookmark, IconSource, BookmarkLocation } from '@/types/bookmark'
import { iconToDisplayUrl, fetchAndCacheIcon, fetchAsDataUrl } from '@/services/iconCache'
import { getTemplateLabel } from '@/lib/utils'
import { normalizeAIConfidence, parseAIJsonObject, truncateAIText } from '@/lib/aiOutput'
import { notify } from '@/lib/notify'
import { addBehaviorLog } from '@/lib/debugReport'
import { fetchMetadataFromNetwork, isLoginOrAccessWallText } from '@/services/metadataFallback'
import {
  getAIAvailability,
  runAIText,
  AIProviderRequestError,
  type AIMessage,
  type AISettingsLike
} from '@/lib/aiProvider'
import { DEFAULT_AI_MODEL } from '@/constants/ai'
import {
  METADATA_SYSTEM_PROMPT,
  METADATA_OUTPUT,
  buildMetadataUserPrompt,
  CATEGORY_SYSTEM_PROMPT,
  CATEGORY_OUTPUT,
  buildCategoryUserPrompt
} from '@/constants/aiPrompts'
import { useBookmarkStore, TRASH_GROUP_ID } from '@/stores/bookmark'
import { useSettingsStore, selectAiSettings } from '@/stores/settings'
import { useUIManager } from './useUIManager'
import type { MetadataSource } from './useAI'

/**
 * 新建/编辑书签表单：模块级 Zustand 单例 + URL 防抖取图标等副作用。
 * AI 走 lib/aiProvider，配置读自 settings store。
 */

const MODEL_ERROR_KEYWORDS = ['model', '模型', 'not found', 'unknown', 'unsupported', 'invalid', '不存在', '不可用', '无效']

export interface CategorySuggestionState {
  groupId: string
  groupName: string
  subGroupId: string
  subGroupName: string
  confidence: number
  reason: string
}

interface DraftState {
  title: string
  url: string
  desc: string
  allowUniversal: boolean
}

interface BookmarkFormState {
  showAdd: boolean
  modalTitle: string
  editingId: string
  draft: DraftState
  draftTags: string[]
  draftLocations: BookmarkLocation[]
  previewIcon: IconSource | null
  showCategorySelector: boolean
  showIconSelector: boolean
  formError: string
  isSaving: boolean
  iconLoading: boolean
  iconFetchFailed: boolean
  iconFetchPhase: 'idle' | 'loading' | 'success' | 'failed'
  isTitleDirty: boolean
  isDescDirty: boolean
  /** 用户已手动填写标题时，抓到的匹配标题不直接覆盖，存为可点击采纳的建议 */
  titleSuggestion: string | null
  originalUrl: string
  /** 最近一次（排定）读取网页信息时的 URL，用于判断链接是否有未读取变更 */
  lastFetchedUrl: string
  isGenerating: boolean
  isSuggestingCategory: boolean
  aiError: string
  originalBeforeAI: { title: string; desc: string } | null
  categorySuggestion: CategorySuggestionState | null

  set: (patch: Partial<BookmarkFormState>) => void
  patchDraft: (patch: Partial<DraftState>) => void
}

const initialDraft = (): DraftState => ({ title: '', url: '', desc: '', allowUniversal: false })

/** 模块级共享表单状态（等价旧版 createSharedComposable 的单例 state） */
export const useBookmarkFormStore = create<BookmarkFormState>((set) => ({
  showAdd: false,
  modalTitle: '新建书签',
  editingId: '',
  draft: initialDraft(),
  draftTags: [],
  draftLocations: [],
  previewIcon: null,
  showCategorySelector: false,
  showIconSelector: false,
  formError: '',
  isSaving: false,
  iconLoading: false,
  iconFetchFailed: false,
  iconFetchPhase: 'idle' as const,
  isTitleDirty: false,
  isDescDirty: false,
  titleSuggestion: null,
  originalUrl: '',
  lastFetchedUrl: '',
  isGenerating: false,
  isSuggestingCategory: false,
  aiError: '',
  originalBeforeAI: null,
  categorySuggestion: null,

  set: (patch) => set(patch),
  patchDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } }))
}))

// ---- 框架无关纯辅助函数（从旧版迁移）----

const getActiveAiSettings = (): AISettingsLike => selectAiSettings(useSettingsStore.getState())

const checkAiAvailable = (): { available: boolean; reason: string } => {
  const availability = getAIAvailability(getActiveAiSettings())
  return availability.ok ? { available: true, reason: '' } : { available: false, reason: availability.reason }
}

const isModelError = (errMsg: string) => {
  const lower = errMsg.toLowerCase()
  return MODEL_ERROR_KEYWORDS.some((key) => lower.includes(key.toLowerCase()))
}

const resolveErrorMessage = (error: unknown, action: '生成' | '分类') => {
  const providerError = error instanceof AIProviderRequestError ? error : null
  const errMsg = error instanceof Error ? error.message : String(error)
  const settings = getActiveAiSettings()
  const modelInfo = providerError
    ? { model: providerError.model || settings.selectedModelId || DEFAULT_AI_MODEL, isCustom: providerError.isCustomModel }
    : { model: settings.selectedModelId || DEFAULT_AI_MODEL, isCustom: settings.useCustomProvider }

  if (errMsg.includes('余额') || errMsg.includes('balance') || errMsg.includes('quota')) {
    return 'AI 余额不足，请检查当前供应商额度'
  }
  if (errMsg.includes('network') || errMsg.includes('timeout') || errMsg.includes('连接')) {
    return 'AI 服务连接失败，请检查网络'
  }
  if (isModelError(errMsg)) {
    if (modelInfo.isCustom) return `自定义模型“${modelInfo.model}”不可用，请检查供应商配置或模型名后重试`
    if (providerError?.fallbackAttempted)
      return `uTools 模型“${modelInfo.model}”不可用，自动回退后仍失败，请检查 AI 配置后重试`
    return `uTools 模型“${modelInfo.model}”当前不可用，请重新选择或稍后重试`
  }
  if (modelInfo.isCustom)
    return `AI ${action}失败，请稍后重试；若持续失败，请检查接口配置和模型“${modelInfo.model}”`
  return `AI ${action}失败，请稍后重试`
}

const generateMetadataDirect = async (input: {
  url: string
  title?: string
  desc?: string
  forceNetworkFallback?: boolean
}): Promise<{ title: string; desc: string; source: MetadataSource; usedNetworkFallback: boolean } | null> => {
  const params = {
    url: input.url,
    title: input.title?.trim() || '',
    desc: input.desc?.trim() || '',
    forceNetworkFallback: !!input.forceNetworkFallback
  }
  if (!params.url) return null

  const prompt = buildMetadataUserPrompt(params)

  const messages: AIMessage[] = [
    {
      role: 'system',
      content: METADATA_SYSTEM_PROMPT
    },
    { role: 'user', content: prompt }
  ]

  const res = await runAIText(getActiveAiSettings(), messages, { output: METADATA_OUTPUT })
  try {
    const data = parseAIJsonObject(res)
    return {
      title: truncateAIText(data.title, 15),
      desc: truncateAIText(data.desc, 40),
      source: data.source === 'network' || params.forceNetworkFallback ? 'network' : 'ai',
      usedNetworkFallback: params.forceNetworkFallback
    }
  } catch {
    return null
  }
}

const isHostLikeTitle = (title: string, rawUrl: string) => {
  const normalizedTitle = title.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')
  if (!normalizedTitle) return false
  try {
    const safeUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`
    const host = new URL(safeUrl).hostname.toLowerCase().replace(/^www\./, '')
    return normalizedTitle === host
  } catch {
    return false
  }
}

const buildTextIconFromValue = (value: string): IconSource => {
  const base = value.trim()
  const text = base ? base.slice(0, 4).toUpperCase() : '•'
  return { type: 'text', value: text }
}

export const isValidUrlInput = (rawUrl: string) => {
  const input = rawUrl.trim()
  if (!input) return false
  if (/^javascript:/i.test(input) || /^file:/i.test(input)) return false
  const candidate = input.replace(/{[^}]+}/g, 'x')
  const normalized = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`
  try {
    const parsed = new URL(normalized)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const toIconSource = (icon: Awaited<ReturnType<typeof fetchAndCacheIcon>>): IconSource | null => {
  if (!icon) return null
  const nextIcon: Record<string, any> = { type: icon.type }
  if ('src' in icon && icon.src) nextIcon.src = icon.src
  if ('path' in icon && icon.path) nextIcon.path = icon.path
  if ('value' in icon && icon.value) nextIcon.value = icon.value
  if ('cache' in icon && icon.cache) nextIcon.cache = icon.cache
  if ('bgColor' in icon && icon.bgColor) nextIcon.bgColor = icon.bgColor
  if ('fetchedAt' in icon && icon.fetchedAt) nextIcon.fetchedAt = icon.fetchedAt
  return nextIcon as IconSource
}

const shouldHydrateTitle = (initialTitle: string, currentTitle: string) =>
  !initialTitle.trim() && !currentTitle.trim()
const shouldHydrateDesc = (initialDesc: string, currentDesc?: string) =>
  !initialDesc.trim() && !(currentDesc || '').trim()

// 后台元信息补全任务（模块级，跨实例共享 job 表，等价旧版单例）
const hydrationJobIds = new Map<string, number>()

// 导出供 uTools 快速收集复用：快存只落 URL，标题/简介靠这套后台水合补全（与表单流程同一实现）
export const enqueueMetadataHydration = (
  bookmarkId: string,
  options: { url: string; initialTitle: string; initialDesc: string; forceAi?: boolean }
) => {
  const jobId = Date.now() + Math.random()
  hydrationJobIds.set(bookmarkId, jobId)

  void (async () => {
    let usedNetworkFallback = false
    try {
      const fetched = await fetchAndCacheIcon(options.url, true)
      let rawTitle = typeof fetched?.title === 'string' ? fetched.title.trim() : ''
      let rawDesc = typeof fetched?.description === 'string' ? fetched.description.trim() : ''
      const hydratedIcon = toIconSource(fetched)
      if (rawTitle && (isHostLikeTitle(rawTitle, options.url) || isLoginOrAccessWallText(rawTitle))) {
        rawTitle = ''
      }
      if (rawDesc && isLoginOrAccessWallText(rawDesc)) rawDesc = ''

      if (!rawTitle || !rawDesc) {
        const fallback = await fetchMetadataFromNetwork(options.url)
        if (fallback) {
          if (!rawTitle && fallback.title && !isHostLikeTitle(fallback.title, options.url) && !isLoginOrAccessWallText(fallback.title)) {
            rawTitle = fallback.title
          }
          if (!rawDesc && fallback.description && !isLoginOrAccessWallText(fallback.description)) {
            rawDesc = fallback.description
          }
          usedNetworkFallback = true
        }
      }

      let nextTitle = rawTitle && !isHostLikeTitle(rawTitle, options.url) && !isLoginOrAccessWallText(rawTitle) ? rawTitle : ''
      let nextDesc = rawDesc && !isLoginOrAccessWallText(rawDesc) ? rawDesc : ''

      const aiReady = checkAiAvailable().available
      if (options.forceAi && aiReady) {
        const aiResult = await generateMetadataDirect({
          url: options.url,
          title: rawTitle,
          desc: rawDesc,
          forceNetworkFallback: usedNetworkFallback
        })
        if (aiResult) {
          nextTitle = aiResult.title || nextTitle
          nextDesc = aiResult.desc || nextDesc
        }
      }

      if (hydrationJobIds.get(bookmarkId) !== jobId) return

      const store = useBookmarkStore.getState()
      const bookmark = store.bookmarks.find((item) => item.id === bookmarkId)
      if (!bookmark) return

      const patch: Partial<Bookmark> = {}
      if (nextTitle && shouldHydrateTitle(options.initialTitle, bookmark.title)) patch.title = nextTitle
      if (nextDesc && shouldHydrateDesc(options.initialDesc, bookmark.desc)) patch.desc = nextDesc
      if (hydratedIcon && (!bookmark.icon || bookmark.icon.type === 'text')) {
        patch.icon = hydratedIcon
      } else if (!bookmark.icon && (nextTitle || options.url)) {
        patch.icon = buildTextIconFromValue(nextTitle || options.url)
      }

      if (Object.keys(patch).length > 0) store.updateBookmark(bookmarkId, patch)
    } catch (error) {
      console.warn('[BookmarkForm] background hydration failed:', error)
    } finally {
      if (hydrationJobIds.get(bookmarkId) === jobId) hydrationJobIds.delete(bookmarkId)
    }
  })()
}

// URL 变更后取图标的防抖定时器（模块级单例）
let urlFetchTimer: ReturnType<typeof setTimeout> | null = null
// 加载态看门狗：兜底强制关闭 iconLoading。防止快速连续改 URL 时，旧 timer 被 clearTimeout、
// 代际计数器又被并发逻辑（关表单/重置）额外递增，使最新 timer 回调因 id 不匹配而 return，
// 导致 iconLoading 永远停在 true、识别环一直转的竞态。
let iconLoadingWatchdog: ReturnType<typeof setTimeout> | null = null
const ICON_LOADING_WATCHDOG_MS = 6000
// 粘贴链接后自动读取的防抖（粘贴是「一次成型」的输入，短防抖即可；打字不触发自动读取）
export const URL_FETCH_PASTE_DEBOUNCE_MS = 500
export const URL_FETCH_IMMEDIATE_MS = 400
// 表单内联网兜底总预算：Jina 读页 + 登录墙时域名服务摘要（DDG/Wikipedia）
const JINA_FALLBACK_TIMEOUT_MS = 12000
// 单调递增请求序号，用于丢弃乱序响应（慢请求覆盖后输入 URL 的竞态保护）
let urlFetchRequestId = 0
// askAI 请求代际计数器：区分同 URL 的并发请求与跨表单会话的在途请求
let askAiRequestId = 0

export function useBookmarkForm() {
  const form = useBookmarkFormStore(
    useShallow((s) => ({
      showAdd: s.showAdd,
      modalTitle: s.modalTitle,
      editingId: s.editingId,
      draft: s.draft,
      draftLocations: s.draftLocations,
      previewIcon: s.previewIcon,
      showCategorySelector: s.showCategorySelector,
      showIconSelector: s.showIconSelector,
      formError: s.formError,
      isSaving: s.isSaving,
      iconLoading: s.iconLoading,
      iconFetchFailed: s.iconFetchFailed,
      iconFetchPhase: s.iconFetchPhase,
      isGenerating: s.isGenerating,
      isSuggestingCategory: s.isSuggestingCategory,
      aiError: s.aiError,
      categorySuggestion: s.categorySuggestion,
      originalBeforeAI: s.originalBeforeAI,
      originalUrl: s.originalUrl,
      lastFetchedUrl: s.lastFetchedUrl,
      isTitleDirty: s.isTitleDirty,
      isDescDirty: s.isDescDirty,
      titleSuggestion: s.titleSuggestion
    }))
  )
  const set = useBookmarkFormStore((s) => s.set)
  const patchDraft = useBookmarkFormStore((s) => s.patchDraft)

  const showToast = useUIManager((s) => s.showToast)

  // ---- 计算属性（等价旧版 computed）----
  const isEditing = !!form.editingId
  const previewText = useMemo(() => {
    const text = (form.draft.title || form.draft.url || '').trim()
    return text ? text.slice(0, 4) : 'ICON'
  }, [form.draft.title, form.draft.url])
  const previewIconUrl = useMemo(() => iconToDisplayUrl(form.previewIcon ?? undefined), [form.previewIcon])
  const previewIconStyle = useMemo(
    () => ({ backgroundColor: form.previewIcon?.bgColor || 'transparent' }),
    [form.previewIcon]
  )
  const isDraftTemplate = useMemo(() => /{[^}]+}/.test(form.draft.url), [form.draft.url])
  const draftTemplateLabel = useMemo(() => getTemplateLabel(form.draft.url), [form.draft.url])
  const needsBackgroundSave = useMemo(() => {
    if (!form.draft.url.trim()) return false
    if (form.iconLoading || form.isGenerating) return true
    return !form.draft.title.trim()
  }, [form.draft.url, form.draft.title, form.iconLoading, form.isGenerating])
  const saveButtonLabel = needsBackgroundSave ? '后台保存' : '保存'
  const aiEnabled = useSettingsStore((s) => s.aiEnabled)
  const aiAvailability = useMemo(() => checkAiAvailable(), [aiEnabled, form.showAdd])
  const canUseAi = aiAvailability.available
  const aiUnavailableReason = aiAvailability.reason
  const hasAIGenerated = !!form.originalBeforeAI
  const selectedLocationsLabel = useMemo(() => {
    if (form.draftLocations.length === 0) return ''
    const groups = useBookmarkStore.getState().groups
    return form.draftLocations
      .map((loc) => {
        const group = groups.find((g) => g.id === loc.groupId)
        const sub = group?.children.find((c) => c.id === loc.subGroupId)
        return group && sub ? `${group.name} / ${sub.name}` : ''
      })
      .filter(Boolean)
      .join(', ')
  }, [form.draftLocations])

  // ---- 动作 ----
  const buildTextIcon = useCallback((): IconSource => {
    const { draft } = useBookmarkFormStore.getState()
    const base = (draft.title || draft.url).trim()
    const text = base ? base.slice(0, 4).toUpperCase() : '•'
    return { type: 'text', value: text }
  }, [])

  const resolveLocationsForSave = useCallback((): BookmarkLocation[] => {
    const { draftLocations } = useBookmarkFormStore.getState()
    if (draftLocations.length > 0) return [...draftLocations]
    const store = useBookmarkStore.getState()
    const activeGroup = store.groups.find((group) => group.id === store.activeGroupId) ?? store.groups[0]
    const activeSubGroup =
      activeGroup?.children.find((child) => child.id === store.activeSubGroupId) ?? activeGroup?.children[0]
    if (!activeGroup || !activeSubGroup) return []
    return [{ groupId: activeGroup.id, subGroupId: activeSubGroup.id }]
  }, [])

  const resetPendingIconFetch = useCallback(() => {
    if (urlFetchTimer) {
      clearTimeout(urlFetchTimer)
      urlFetchTimer = null
    }
    if (iconLoadingWatchdog) {
      clearTimeout(iconLoadingWatchdog)
      iconLoadingWatchdog = null
    }
    // 递增代际计数器，使所有在途的图标/AI 响应作废：
    // 关表单再打开同 URL 的另一表单时，旧会话的慢响应不能写进新会话。
    // 在途请求作废后其 finally 不再清 isGenerating，这里一并兜底重置。
    urlFetchRequestId++
    askAiRequestId++
    set({ iconLoading: false, iconFetchFailed: false, iconFetchPhase: 'idle', isGenerating: false })
  }, [set])

  /** 解析新建默认「放到哪里」：优先 preferred，否则 store.active*；过滤回收站；无效则回退首个有效组+首子组 */
  const resolveDefaultDraftLocations = useCallback(
    (preferred?: { groupId?: string | null; subGroupId?: string | null }): BookmarkLocation[] => {
      const store = useBookmarkStore.getState()
      const validGroups = store.groups.filter((g) => g.id !== TRASH_GROUP_ID && g.children.length > 0)
      if (validGroups.length === 0) return []

      const preferGroupId = (preferred?.groupId || store.activeGroupId || '').trim()
      const preferSubId = (preferred?.subGroupId || store.activeSubGroupId || '').trim()

      let group =
        preferGroupId && preferGroupId !== TRASH_GROUP_ID
          ? validGroups.find((g) => g.id === preferGroupId)
          : undefined
      if (!group) group = validGroups[0]

      let sub = preferSubId ? group.children.find((c) => c.id === preferSubId) : undefined
      if (!sub) sub = group.children[0]
      if (!sub) return []

      return [{ groupId: group.id, subGroupId: sub.id }]
    },
    []
  )

  const openAdd = useCallback(
    (preferred?: { groupId?: string | null; subGroupId?: string | null }) => {
      resetPendingIconFetch()
      const draftLocations = resolveDefaultDraftLocations(preferred)
      set({
        editingId: '',
        modalTitle: '新建书签',
        draft: initialDraft(),
        draftTags: [],
        draftLocations,
        previewIcon: null,
        formError: '',
        isTitleDirty: false,
        isDescDirty: false,
        titleSuggestion: null,
        originalUrl: '',
        lastFetchedUrl: '',
        showAdd: true
      })
    },
    [resetPendingIconFetch, resolveDefaultDraftLocations, set]
  )

  const openEdit = useCallback(
    (bookmark: Bookmark) => {
      resetPendingIconFetch()
      const store = useBookmarkStore.getState()
      set({
        editingId: bookmark.id,
        modalTitle: '编辑书签',
        draft: {
          title: bookmark.title || '',
          url: bookmark.url,
          allowUniversal: bookmark.allowUniversal ?? false,
          desc: bookmark.desc || ''
        },
        previewIcon: bookmark.icon ?? null,
        formError: '',
        isTitleDirty: true,
        titleSuggestion: null,
        originalUrl: bookmark.url,
        lastFetchedUrl: bookmark.url,
        draftTags: [...(bookmark.tags ?? [])],
        draftLocations: store.getBookmarkLocations(bookmark.id),
        showAdd: true
      })
    },
    [resetPendingIconFetch, set]
  )

  const askAI = useCallback(
    async (showNotify = false) => {
      const { draft, originalBeforeAI } = useBookmarkFormStore.getState()
      if (!draft.url) return

      const { available, reason } = checkAiAvailable()
      if (!available) {
        if (showNotify) notify(reason)
        set({ formError: reason })
        return
      }

      if (!originalBeforeAI) {
        set({ originalBeforeAI: { title: draft.title, desc: draft.desc } })
      }

      addBehaviorLog('ask-ai', draft.url)
      set({ isGenerating: true, aiError: '' })
      // 代际校验：requestId 区分同 URL 的并发请求/跨会话请求，URL 校验作第二道防线
      const thisAskAiId = ++askAiRequestId
      const askAiUrl = draft.url
      try {
        const res = await generateMetadataDirect({ url: draft.url, title: draft.title, desc: draft.desc })
        // 已有更新的请求发起，或用户已切换 URL：丢弃本次 AI 生成结果
        if (thisAskAiId !== askAiRequestId) return
        if (useBookmarkFormStore.getState().draft.url !== askAiUrl) return
        if (res) {
          const patch: Partial<DraftState> = {}
          if (res.title) patch.title = res.title
          if (res.desc) patch.desc = res.desc
          if (Object.keys(patch).length) patchDraft(patch)
        }
      } catch (error) {
        if (thisAskAiId !== askAiRequestId) return
        const message = resolveErrorMessage(error, '生成')
        set({ aiError: message })
        if (showNotify) notify(message)
        set({ formError: message })
      } finally {
        // 只有仍是最新请求时才清 isGenerating，避免旧请求先结束误关新请求的加载态
        if (thisAskAiId === askAiRequestId) set({ isGenerating: false })
      }
    },
    [set, patchDraft]
  )

  /**
   * URL 元信息抓取结束后的自动 AI 清洗润色（仅新建 + 设置开启 + AI 可用）。
   * 不覆盖用户已 dirty 的标题/简介；代际与 URL 一致性与 askAI 一致。
   */
  const runAutoPolishAfterFetch = useCallback(
    async (input: {
      url: string
      forceNetworkFallback: boolean
      /** 绑定本次 url 抓取代际：抓取已被新请求取代则跳过 */
      fetchRequestId: number
    }) => {
      if (!input.url) return
      if (input.fetchRequestId !== urlFetchRequestId) return

      const settings = useSettingsStore.getState()
      if (!settings.aiFormAutoPolish) return
      if (!checkAiAvailable().available) return

      const form = useBookmarkFormStore.getState()
      if (form.editingId) return
      if (form.draft.url !== input.url) return
      // 标题与简介都已被用户接管时无需自动跑
      if (form.isTitleDirty && form.isDescDirty) return

      if (!form.originalBeforeAI) {
        set({ originalBeforeAI: { title: form.draft.title, desc: form.draft.desc } })
      }

      addBehaviorLog('auto-polish', input.url)
      set({ isGenerating: true, aiError: '' })
      const thisAskAiId = ++askAiRequestId
      try {
        const latest = useBookmarkFormStore.getState()
        const res = await generateMetadataDirect({
          url: input.url,
          title: latest.draft.title,
          desc: latest.draft.desc,
          forceNetworkFallback: input.forceNetworkFallback
        })
        if (thisAskAiId !== askAiRequestId) return
        if (input.fetchRequestId !== urlFetchRequestId) return
        const after = useBookmarkFormStore.getState()
        if (after.draft.url !== input.url) return
        if (!res) return

        const patch: Partial<DraftState> = {}
        if (res.title && !after.isTitleDirty) patch.title = res.title
        if (res.desc && !after.isDescDirty) patch.desc = res.desc
        if (Object.keys(patch).length) patchDraft(patch)
      } catch (error) {
        if (thisAskAiId !== askAiRequestId) return
        const message = resolveErrorMessage(error, '生成')
        set({ aiError: message })
      } finally {
        if (thisAskAiId === askAiRequestId) set({ isGenerating: false })
      }
    },
    [set, patchDraft]
  )

  const undoTitle = useCallback(() => {
    const { originalBeforeAI } = useBookmarkFormStore.getState()
    if (!originalBeforeAI) return
    patchDraft({ title: originalBeforeAI.title })
  }, [patchDraft])

  const undoDesc = useCallback(() => {
    const { originalBeforeAI } = useBookmarkFormStore.getState()
    if (!originalBeforeAI) return
    patchDraft({ desc: originalBeforeAI.desc })
  }, [patchDraft])

  const onTitleInput = useCallback(() => set({ isTitleDirty: true }), [set])
  const takeOverTitle = useCallback(() => set({ isTitleDirty: true }), [set])
  // 采纳匹配到的标题：替换用户手动填写的内容（视为用户主动选择，保持 dirty）
  const applyTitleSuggestion = useCallback(() => {
    const { titleSuggestion } = useBookmarkFormStore.getState()
    if (!titleSuggestion) return
    patchDraft({ title: titleSuggestion })
    set({ titleSuggestion: null, isTitleDirty: true })
  }, [patchDraft, set])
  const takeOverDesc = useCallback(() => set({ isDescDirty: true }), [set])
  const onDescInput = useCallback(
    (val: string) => {
      set({ isDescDirty: true })
      patchDraft({ desc: val })
    },
    [set, patchDraft]
  )

  const applyCategorySuggestion = useCallback(
    (options?: { silent?: boolean; keepSuggestion?: boolean }) => {
      const { categorySuggestion } = useBookmarkFormStore.getState()
      if (!categorySuggestion) return
      set({
        draftLocations: [{ groupId: categorySuggestion.groupId, subGroupId: categorySuggestion.subGroupId }]
      })
      if (!options?.keepSuggestion) set({ categorySuggestion: null })
      if (!options?.silent) showToast({ title: '已应用分类建议', variant: 'success' })
    },
    [set, showToast]
  )

  const askCategorySuggestion = useCallback(async () => {
    const { draft } = useBookmarkFormStore.getState()
    if (!draft.url) return

    const { available, reason } = checkAiAvailable()
    if (!available) {
      showToast({ title: reason, variant: 'warning' })
      return
    }

    const store = useBookmarkStore.getState()
    const existingGroups = store.groups
      .filter((g) => g.id !== TRASH_GROUP_ID)
      .map((g) => ({ id: g.id, name: g.name, subGroups: g.children.map((c) => ({ id: c.id, name: c.name })) }))

    if (existingGroups.length === 0) {
      showToast({ title: '请先创建分组', variant: 'warning' })
      return
    }

    addBehaviorLog('ask-category-suggestion', draft.url)
    set({ isSuggestingCategory: true, aiError: '' })

    try {
      const prompt = buildCategoryUserPrompt({
        url: draft.url,
        groups: existingGroups.map((group) => ({
          name: group.name,
          subGroups: group.subGroups
        })),
        concise: true
      })

      const res = await runAIText(getActiveAiSettings(), [
        {
          role: 'system',
          content: CATEGORY_SYSTEM_PROMPT
        },
        { role: 'user', content: prompt }
      ], { output: CATEGORY_OUTPUT })

      let data: Record<string, unknown>
      try {
        data = parseAIJsonObject(res)
      } catch {
        showToast({ title: 'AI 返回格式异常，请重试', variant: 'warning' })
        return
      }
      // groupName 为空字符串时 includes('') 会误选第一个分组，trim 后为空视为无建议（问题6）
      const groupNameStr = typeof data.groupName === 'string' ? data.groupName.trim() : ''
      const matchedGroup = groupNameStr
        ? existingGroups.find((group) => group.name === groupNameStr)
        : undefined

      if (matchedGroup) {
        const matchedSubGroup = data.subGroupName
          ? matchedGroup.subGroups.find((s) => s.name === data.subGroupName)
          : matchedGroup.subGroups[0]

        if (!matchedSubGroup) {
          showToast({ title: 'AI 返回的子分组不在现有列表中', variant: 'info' })
          return
        }

        const result: CategorySuggestionState = {
          groupId: matchedGroup.id,
          groupName: matchedGroup.name,
          subGroupId: matchedSubGroup?.id || matchedGroup.subGroups[0]?.id || '',
          subGroupName: matchedSubGroup?.name || matchedGroup.subGroups[0]?.name || '',
          confidence: normalizeAIConfidence(data.confidence),
          reason: truncateAIText(data.reason, 30) || '基于 URL 内容推荐'
        }
        set({ categorySuggestion: result })
      } else {
        showToast({ title: '未找到合适的分类建议', variant: 'info' })
      }
    } catch (error) {
      const message = resolveErrorMessage(error, '分类')
      set({ aiError: message })
      showToast({ title: message, variant: 'warning' })
    } finally {
      set({ isSuggestingCategory: false })
    }
  }, [set, showToast, applyCategorySuggestion])

  const dismissCategorySuggestion = useCallback(() => set({ categorySuggestion: null }), [set])

  const requestDelete = useCallback(() => {
    const { editingId } = useBookmarkFormStore.getState()
    if (!editingId) return
    addBehaviorLog('delete-bookmark', `id: ${editingId}`)
    useBookmarkStore.getState().removeBookmark(editingId)
    set({ showAdd: false })
    showToast({ title: '书签已删除', variant: 'success', duration: 2000 })
  }, [set, showToast])

  const handleSave = useCallback(
    async (options?: { forceAi?: boolean; background?: boolean }) => {
      const state = useBookmarkFormStore.getState()
      const { draft, editingId, previewIcon, iconLoading, isGenerating } = state
      set({ formError: '' })

      if (!draft.url.trim()) return set({ formError: '请输入链接' })
      if (!isValidUrlInput(draft.url)) return set({ formError: '请输入有效链接' })
      if (state.isSaving) return
      set({ isSaving: true })

      try {
        const locationsToSave = resolveLocationsForSave()
        if (locationsToSave.length === 0) {
          set({ formError: '请选择分类' })
          return
        }

        const titleToSave = draft.title.trim()
        const descToSave = draft.desc.trim()
        const urlToSave = draft.url.trim()
        addBehaviorLog(editingId ? 'edit-bookmark' : 'add-bookmark', `${draft.title} ${draft.url}`.trim())
        let iconToSave = previewIcon ?? buildTextIcon()

        if (iconToSave.type === 'remote' && !iconToSave.cache && iconToSave.src) {
          const base64 = await fetchAsDataUrl(iconToSave.src)
          if (base64) iconToSave = { ...iconToSave, cache: base64, fetchedAt: Date.now() }
        }

        const store = useBookmarkStore.getState()

        if (editingId) {
          store.updateBookmark(editingId, {
            title: titleToSave,
            url: urlToSave,
            desc: descToSave,
            allowUniversal: draft.allowUniversal,
            tags: [...state.draftTags],
            icon: iconToSave
          })
          store.updateBookmarkLocations(editingId, locationsToSave)
        } else {
          const created = store.addBookmark(
            {
              title: titleToSave,
              url: urlToSave,
              desc: descToSave,
              allowUniversal: draft.allowUniversal,
              tags: [...state.draftTags],
              pinned: false,
              icon: iconToSave
            },
            locationsToSave
          )
          if (created && iconToSave?.type === 'text') void store.refreshSingleIcon(created)

          const shouldHydrateInBackground =
            !!options?.forceAi ||
            !!options?.background ||
            !titleToSave ||
            !descToSave ||
            !previewIcon ||
            iconLoading ||
            isGenerating

          if (shouldHydrateInBackground) {
            enqueueMetadataHydration(created.id, {
              url: urlToSave,
              initialTitle: titleToSave,
              initialDesc: descToSave,
              forceAi: options?.forceAi
            })
          }

          const firstLoc = locationsToSave[0]
          if (firstLoc) {
            store.setSearch('')
            store.selectGroup(firstLoc.groupId, firstLoc.subGroupId)
          }
        }

        set({ showAdd: false })
      } finally {
        set({ isSaving: false })
      }
    },
    [set, resolveLocationsForSave, buildTextIcon]
  )

  // 手动触发抓取；debounceMs 默认 400（读取按钮/失焦/重试），粘贴后自动读取用 500ms 短防抖。
  const runUrlFetch = useCallback((debounceMs = URL_FETCH_IMMEDIATE_MS) => {
    const { editingId, originalUrl } = useBookmarkFormStore.getState()
    const val = useBookmarkFormStore.getState().draft.url
    if (!val) return
    // 编辑模式下：URL 未变化则跳过取图标/标题
    if (editingId && val === originalUrl) return

    if (urlFetchTimer) clearTimeout(urlFetchTimer)
    // 每次发起前递增 id，响应回来后校验是否仍是最新请求
    const thisRequestId = ++urlFetchRequestId
    // 排定抓取即进入加载态：标题/描述流光在识别阶段开始转，避免快速响应时加载态一闪而过
    set({ iconLoading: true, iconFetchFailed: false, iconFetchPhase: 'loading', lastFetchedUrl: val, titleSuggestion: null })
    // 启动加载态看门狗：即便本次请求回调因代际竞态被丢弃，也保证加载态在总预算后强制落定，
    // 识别环不会无限转。正常回调会在 finally 里清掉它。
    if (iconLoadingWatchdog) clearTimeout(iconLoadingWatchdog)
    iconLoadingWatchdog = setTimeout(() => {
      iconLoadingWatchdog = null
      const s = useBookmarkFormStore.getState()
      if (!s.iconLoading) return
      set({
        iconLoading: false,
        previewIcon: s.previewIcon ?? buildTextIconFromValue(val),
        iconFetchFailed: !s.previewIcon,
        iconFetchPhase: s.iconFetchPhase === 'success' ? 'success' : 'failed'
      })
    }, ICON_LOADING_WATCHDOG_MS)
    urlFetchTimer = setTimeout(async () => {
      urlFetchTimer = null
      let usedNetworkFallback = false
      let titleUsable = false
      let fetchSettled = false
      try {
        const fetched = await Promise.race([
          fetchAndCacheIcon(val, true),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000))
        ])
        let latest = useBookmarkFormStore.getState()
        // 双重校验：(1) 请求 id 仍是最新；(2) 当前 draft.url 与发起时一致
        // 任一不满足说明用户已切换 URL，丢弃本次响应
        if (thisRequestId !== urlFetchRequestId || latest.draft.url !== val) return

        let metaTitle = typeof fetched?.title === 'string' ? fetched.title.trim() : ''
        let metaDesc = typeof fetched?.description === 'string' ? fetched.description.trim() : ''
        if (metaTitle && isLoginOrAccessWallText(metaTitle)) metaTitle = ''
        if (metaDesc && isLoginOrAccessWallText(metaDesc)) metaDesc = ''
        titleUsable = !!metaTitle && !isHostLikeTitle(metaTitle, val) && !isLoginOrAccessWallText(metaTitle)

        // 联网兜底：Jina 读页；登录墙/缺字段时再查域名公开服务摘要
        if ((!titleUsable && !latest.isTitleDirty) || (!metaDesc && !latest.isDescDirty)) {
          const fallback = await fetchMetadataFromNetwork(val, JINA_FALLBACK_TIMEOUT_MS)
          latest = useBookmarkFormStore.getState()
          if (thisRequestId !== urlFetchRequestId || latest.draft.url !== val) return
          if (fallback) {
            usedNetworkFallback = true
            if (
              !titleUsable &&
              fallback.title &&
              !isHostLikeTitle(fallback.title, val) &&
              !isLoginOrAccessWallText(fallback.title)
            ) {
              metaTitle = fallback.title
              titleUsable = true
            }
            if (!metaDesc && fallback.description && !isLoginOrAccessWallText(fallback.description)) {
              metaDesc = fallback.description
            }
          }
        }

        if (fetched || titleUsable || metaDesc) {
          const newIcon = fetched ? toIconSource(fetched) : buildTextIconFromValue(val)
          set({
            previewIcon: newIcon,
            iconFetchFailed: fetched
              ? fetched.type === 'text' || (fetched.type === 'remote' && !fetched.src)
              : true,
            iconFetchPhase: 'success'
          })
          if (titleUsable && !latest.isTitleDirty) {
            patchDraft({ title: metaTitle })
          } else if (titleUsable) {
            // 用户已手动填写标题：不覆盖，把匹配到的标题存为可点击采纳的建议
            set({ titleSuggestion: metaTitle !== latest.draft.title.trim() ? metaTitle : null })
          }
          if (metaDesc && !latest.isDescDirty) patchDraft({ desc: metaDesc })
          // 流光结束但有字段没拿到：告知原因，引导手动填写（用户接管的字段不计入）
          const missing = [
            !titleUsable && !latest.isTitleDirty ? '标题' : '',
            !metaDesc && !latest.isDescDirty ? '描述' : ''
          ].filter(Boolean)
          if (missing.length > 0) {
            showToast({
              title: `未能获取${missing.join('和')}：站点未提供该信息或访问受限，请手动填写`,
              variant: 'info'
            })
          }
        } else {
          set({ previewIcon: buildTextIconFromValue(val), iconFetchFailed: true, iconFetchPhase: 'failed' })
          if (!latest.draft.title.trim()) {
            showToast({ title: '未能获取标题和描述：站点无响应或返回为空，请手动填写', variant: 'info' })
          }
        }
        fetchSettled = true
      } catch {
        // 代际校验：旧会话的失败响应不覆盖新表单
        const latestOnCatch = useBookmarkFormStore.getState()
        if (thisRequestId !== urlFetchRequestId || latestOnCatch.draft.url !== val) return
        set({ previewIcon: buildTextIconFromValue(val), iconFetchFailed: true, iconFetchPhase: 'failed' })
        showToast({ title: '获取网页信息失败：网络异常或站点拒绝访问，请手动填写标题和描述', variant: 'warning' })
        fetchSettled = true
      } finally {
        // iconLoading 只在请求仍有效时才关闭（已被新请求接管则不干扰）
        if (thisRequestId === urlFetchRequestId) {
          set({ iconLoading: false })
          // 本次请求正常落定，撤销看门狗兜底
          if (iconLoadingWatchdog) {
            clearTimeout(iconLoadingWatchdog)
            iconLoadingWatchdog = null
          }
          // 抓取结束后（成功/失败）尝试 AI 清洗润色；有 URL 即可
          if (fetchSettled) {
            void runAutoPolishAfterFetch({
              url: val,
              forceNetworkFallback: usedNetworkFallback || !titleUsable,
              fetchRequestId: thisRequestId
            })
          }
        }
      }
    }, debounceMs)
  }, [runAutoPolishAfterFetch, set, patchDraft, showToast])

  // ---- 副作用：URL 变更仅清空遗留标题/预览（自动重抓仅在确认页 ConfirmStep）----
  const draftUrl = form.draft.url
  useEffect(() => {
    const { isTitleDirty, isDescDirty, editingId } = useBookmarkFormStore.getState()
    const val = draftUrl
    // 链接一变，旧链接的匹配标题建议即失效
    set({ titleSuggestion: null })

    if (!val) {
      if (urlFetchTimer) {
        clearTimeout(urlFetchTimer)
        urlFetchTimer = null
      }
      urlFetchRequestId++
      resetPendingIconFetch()
      set({ previewIcon: null, iconLoading: false, iconFetchPhase: 'idle' })
      if (!isTitleDirty) patchDraft({ title: '' })
      if (!isDescDirty) patchDraft({ desc: '' })
      return
    }

    if (!isTitleDirty && !editingId) patchDraft({ title: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftUrl])

  // 模板失效时清掉 allowUniversal（等价旧版 watch(isDraftTemplate)）
  useEffect(() => {
    if (!isDraftTemplate) patchDraft({ allowUniversal: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDraftTemplate])

  // 关闭弹窗时重置状态（等价旧版 watch(showAdd)）
  useEffect(() => {
    if (!form.showAdd) {
      set({
        previewIcon: null,
        showCategorySelector: false,
        iconLoading: false,
        iconFetchPhase: 'idle' as const,
        editingId: '',
        iconFetchFailed: false,
        formError: '',
        isSaving: false,
        isGenerating: false,
        originalBeforeAI: null,
        categorySuggestion: null,
        originalUrl: '',
        lastFetchedUrl: '',
        isTitleDirty: false,
        isDescDirty: false,
        titleSuggestion: null
      })
      if (urlFetchTimer) {
        clearTimeout(urlFetchTimer)
        urlFetchTimer = null
      }
      if (iconLoadingWatchdog) {
        clearTimeout(iconLoadingWatchdog)
        iconLoadingWatchdog = null
      }
      // 关表单即作废所有在途的图标/AI 请求，防止慢响应写入下一次表单会话
      urlFetchRequestId++
      askAiRequestId++
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.showAdd])

  return {
    ...form,
    set,
    patchDraft,
    isEditing,
    maxDescLen: Infinity,
    previewIconStyle,
    previewText,
    previewIconUrl,
    selectedLocationsLabel,
    isDraftTemplate,
    draftTemplateLabel,
    needsBackgroundSave,
    saveButtonLabel,
    aiEnabled,
    canUseAi,
    aiUnavailableReason,
    hasAIGenerated,
    openAdd,
    openEdit,
    handleSave,
    runUrlFetch,
    askAI,
    undoTitle,
    undoDesc,
    onTitleInput,
    onDescInput,
    takeOverTitle,
    takeOverDesc,
    applyTitleSuggestion,
    askCategorySuggestion,
    applyCategorySuggestion,
    dismissCategorySuggestion,
    requestDelete,
    checkAiAvailable
  }
}
