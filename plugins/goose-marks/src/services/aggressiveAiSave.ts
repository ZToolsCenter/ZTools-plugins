/**
 * AI 保存：只给 URL → 抓取线索 → 一次 AI 决策（标题/简介/多分组）→ 落库
 */
import type { Bookmark, BookmarkLocation, IconSource } from '@/types/bookmark'
import { normalizeAIConfidence, parseAIJsonObject, truncateAIText } from '@/lib/aiOutput'
import {
  AGGRESSIVE_SAVE_SYSTEM_PROMPT,
  AGGRESSIVE_SAVE_OUTPUT,
  buildAggressiveSaveUserPrompt
} from '@/constants/aiPrompts'
import {
  getAIAvailability,
  runAIText,
  type AISettingsLike
} from '@/lib/aiProvider'
import { fetchAndCacheIcon } from '@/services/iconCache'
import { fetchMetadataFromNetwork, isLoginOrAccessWallText } from '@/services/metadataFallback'
import { useBookmarkStore, TRASH_GROUP_ID } from '@/stores/bookmark'
import { useSettingsStore, selectAiSettings } from '@/stores/settings'
import {
  AggressiveAiSaveError,
  describeAggressiveAiSaveProviderError
} from '@/services/aggressiveAiSaveErrors'

export {
  AggressiveAiSaveError,
  type AggressiveAiSaveErrorCode,
  type AggressiveAiSaveFailure
} from '@/services/aggressiveAiSaveErrors'

export type AggressiveCategoryHit = {
  groupId: string
  groupName: string
  subGroupId: string
  subGroupName: string
  confidence: number
  reason: string
}

export type AggressiveAiSaveResult = {
  bookmark: Bookmark
  title: string
  locations: BookmarkLocation[]
  categories: AggressiveCategoryHit[]
  /** 用于成功提示的分组路径文案，如「工作 / 文档、学习 / 前端」 */
  groupLabels: string[]
  usedFallbackCollect: boolean
  /** 成功卡“撤销”所需的最小快照；已有书签只回滚本次覆盖与新增归属。 */
  undo:
    | { kind: 'created' }
    | { kind: 'updated'; bookmark: Bookmark; locations: BookmarkLocation[] }
}

export type AggressiveAiSavePhase =
  | 'validating'
  | 'fetching'
  | 'analyzing'
  | 'saving'
  | 'completed'

export type AggressiveAiSaveProgress = {
  phase: AggressiveAiSavePhase
  detail: string
}

type AggressiveAiSaveOptions = {
  onProgress?: (progress: AggressiveAiSaveProgress) => void
}

function getActiveAiSettings(): AISettingsLike {
  return selectAiSettings(useSettingsStore.getState())
}

function isHostLikeTitle(title: string, rawUrl: string) {
  const normalizedTitle = title
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
  if (!normalizedTitle) return false
  try {
    const safeUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`
    const host = new URL(safeUrl).hostname.toLowerCase().replace(/^www\./, '')
    return normalizedTitle === host
  } catch {
    return false
  }
}

export function normalizeAggressiveSaveUrl(raw: string): string | null {
  const input = raw.trim()
  if (!input) return null
  if (/^javascript:/i.test(input) || /^file:/i.test(input)) return null
  try {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input)) {
      const u = new URL(input)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
      return input
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input) && !/^[a-zA-Z0-9.-]+:\d+([/?#]|$)/.test(input)) {
      return null
    }
    const normalized = `https://${input}`
    new URL(normalized)
    return normalized
  } catch {
    return null
  }
}

function buildTextIcon(value: string): IconSource {
  const base = value.trim()
  const text = base ? base.slice(0, 4).toUpperCase() : '•'
  return { type: 'text', value: text }
}

type ExistingGroup = {
  id: string
  name: string
  subGroups: { id: string; name: string }[]
}

function matchCategories(
  rawList: unknown,
  existingGroups: ExistingGroup[]
): AggressiveCategoryHit[] {
  if (!Array.isArray(rawList) || existingGroups.length === 0) return []

  const hits: AggressiveCategoryHit[] = []
  const seen = new Set<string>()

  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const groupName = typeof row.groupName === 'string' ? row.groupName.trim() : ''
    if (!groupName) continue

    const confidence = normalizeAIConfidence(row.confidence)
    if (confidence < 0.55) continue

    const matchedGroup = existingGroups.find((g) => g.name === groupName)
    if (!matchedGroup) continue

    const subName = typeof row.subGroupName === 'string' ? row.subGroupName.trim() : ''
    const matchedSub = subName
      ? matchedGroup.subGroups.find((s) => s.name === subName)
      : matchedGroup.subGroups[0]
    if (!matchedSub) continue

    const key = `${matchedGroup.id}:${matchedSub.id}`
    if (seen.has(key)) continue
    seen.add(key)

    hits.push({
      groupId: matchedGroup.id,
      groupName: matchedGroup.name,
      subGroupId: matchedSub.id,
      subGroupName: matchedSub.name,
      confidence,
      reason: truncateAIText(row.reason, 30)
    })

    if (hits.length >= 3) break
  }

  hits.sort((a, b) => b.confidence - a.confidence)
  return hits
}

/**
 * 执行 AI 保存。失败抛 AggressiveAiSaveError。
 */
export async function runAggressiveAiSave(
  rawUrl: string,
  options: AggressiveAiSaveOptions = {}
): Promise<AggressiveAiSaveResult> {
  const reportProgress = (phase: AggressiveAiSavePhase, detail: string) => {
    try {
      options.onProgress?.({ phase, detail })
    } catch {
      // 进度展示不能影响真实保存流程。
    }
  }

  reportProgress('validating', '正在检查链接和 AI 设置…')
  const finalUrl = normalizeAggressiveSaveUrl(rawUrl)
  if (!finalUrl) {
    throw new AggressiveAiSaveError('invalid_url', '链接格式不正确', {
      detail: '只支持 http 或 https 链接。',
      recovery: '请修改链接后重试。'
    })
  }

  const aiSettings = getActiveAiSettings()
  const availability = getAIAvailability(aiSettings)
  if (!availability.ok) {
    throw new AggressiveAiSaveError('ai_unavailable', 'AI 服务尚未配置完成', {
      detail: availability.reason,
      recovery: '请前往“设置 → AI 助手”补全配置后重试。'
    })
  }

  const store = useBookmarkStore.getState()
  const existingGroups: ExistingGroup[] = store.groups
    .filter((g) => g.id !== TRASH_GROUP_ID)
    .map((g) => ({
      id: g.id,
      name: g.name,
      subGroups: (g.children || []).map((c) => ({ id: c.id, name: c.name }))
    }))
    .filter((g) => g.subGroups.length > 0)

  if (existingGroups.length === 0) {
    throw new AggressiveAiSaveError('no_groups', '没有可用的书签分组', {
      detail: 'AI 快速保存需要至少一个包含子分组的书签分组。',
      recovery: '请先创建分组，再重新保存。'
    })
  }

  // 1) 页面线索
  reportProgress('fetching', '正在读取网页标题、简介和图标…')
  let pageTitle = ''
  let pageDesc = ''
  let icon: IconSource | null = null
  try {
    const fetched = await fetchAndCacheIcon(finalUrl, true)
    pageTitle = typeof fetched?.title === 'string' ? fetched.title.trim() : ''
    pageDesc = typeof fetched?.description === 'string' ? fetched.description.trim() : ''
    if (pageTitle && (isHostLikeTitle(pageTitle, finalUrl) || isLoginOrAccessWallText(pageTitle))) {
      pageTitle = ''
    }
    if (pageDesc && isLoginOrAccessWallText(pageDesc)) pageDesc = ''
    if (fetched) {
      const next: Record<string, unknown> = { type: fetched.type }
      if ('src' in fetched && fetched.src) next.src = fetched.src
      if ('path' in fetched && fetched.path) next.path = fetched.path
      if ('value' in fetched && fetched.value) next.value = fetched.value
      if ('cache' in fetched && fetched.cache) next.cache = fetched.cache
      if ('bgColor' in fetched && fetched.bgColor) next.bgColor = fetched.bgColor
      if ('fetchedAt' in fetched && fetched.fetchedAt) next.fetchedAt = fetched.fetchedAt
      icon = next as IconSource
    }
    // 缺标题/简介或登录墙：Jina + 域名公开服务摘要兜底
    if (!pageTitle || !pageDesc) {
      const fallback = await fetchMetadataFromNetwork(finalUrl)
      if (fallback) {
        if (
          !pageTitle &&
          fallback.title &&
          !isHostLikeTitle(fallback.title, finalUrl) &&
          !isLoginOrAccessWallText(fallback.title)
        ) {
          pageTitle = fallback.title
        }
        if (!pageDesc && fallback.description && !isLoginOrAccessWallText(fallback.description)) {
          pageDesc = fallback.description
        }
      }
    }
  } catch (err) {
    console.warn('[aggressiveAiSave] 元信息抓取失败，继续仅靠 AI:', err)
  }

  // 2) 一次 AI 决策
  let title = ''
  let desc = ''
  let categories: AggressiveCategoryHit[] = []

  try {
    reportProgress('analyzing', 'AI 正在生成标题、简介并选择分组…')
    const res = await runAIText(aiSettings, [
      { role: 'system', content: AGGRESSIVE_SAVE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildAggressiveSaveUserPrompt({
          url: finalUrl,
          pageTitle,
          pageDesc,
          groups: existingGroups.map((g) => ({
            name: g.name,
            subGroups: g.subGroups.map((s) => ({ name: s.name }))
          }))
        })
      }
    ], { output: AGGRESSIVE_SAVE_OUTPUT })

    const data = parseAIJsonObject(res)
    title = truncateAIText(data.title, 15)
    desc = truncateAIText(data.desc, 40)
    categories = matchCategories(data.categories, existingGroups)
  } catch (error) {
    console.error('[aggressiveAiSave] AI 失败:', error)
    throw describeAggressiveAiSaveProviderError(error, {
      model: aiSettings.selectedModelId || undefined,
      isCustomModel: aiSettings.useCustomProvider
    })
  }

  // 3) 标题兜底
  if (!title || isHostLikeTitle(title, finalUrl)) {
    title = pageTitle && !isHostLikeTitle(pageTitle, finalUrl) ? pageTitle : ''
  }
  if (!title) {
    try {
      title = new URL(finalUrl).hostname.replace(/^www\./, '')
    } catch {
      title = finalUrl
    }
  }
  if (!desc) desc = pageDesc

  // 4) 分组：无匹配则落入快速收集
  let usedFallbackCollect = false
  if (categories.length === 0) {
    const { group, subGroup } = store.getOrCreateQuickCollectGroup()
    categories = [
      {
        groupId: group.id,
        groupName: group.name,
        subGroupId: subGroup.id,
        subGroupName: subGroup.name,
        confidence: 0,
        reason: '无高置信归类，落入快速收集'
      }
    ]
    usedFallbackCollect = true
  }

  const locations: BookmarkLocation[] = categories.map((c) => ({
    groupId: c.groupId,
    subGroupId: c.subGroupId
  }))

  const iconToSave = icon ?? buildTextIcon(title || finalUrl)

  // 5) 落库（同 URL 已存在则更新元信息并合并分组）
  reportProgress('saving', '正在写入本地书签库…')
  const live = useBookmarkStore.getState()
  const existing = live.bookmarks.find((b) => b.url === finalUrl && !b.isDeleted)
  const previousLocations = existing ? live.getBookmarkLocations(existing.id) : []
  const previousBookmark = existing
    ? {
        ...existing,
        tags: [...(existing.tags || [])],
        locations: previousLocations.map((location) => ({ ...location })),
        icon: existing.icon ? { ...existing.icon } : undefined
      }
    : null

  let bookmark: Bookmark
  if (existing) {
    const mergedMap = new Map<string, BookmarkLocation>()
    for (const loc of [...previousLocations, ...locations]) {
      mergedMap.set(`${loc.groupId}:${loc.subGroupId}`, loc)
    }
    const merged = Array.from(mergedMap.values())
    live.updateBookmark(existing.id, {
      title: title || existing.title,
      desc: desc || existing.desc,
      icon: existing.icon?.type === 'text' ? iconToSave : existing.icon
    })
    live.updateBookmarkLocations(existing.id, merged)
    bookmark = live.bookmarks.find((b) => b.id === existing.id) ?? { ...existing, title, desc, locations: merged }
  } else {
    bookmark = live.addBookmark(
      {
        title,
        url: finalUrl,
        desc,
        tags: [],
        pinned: false,
        allowUniversal: false,
        icon: iconToSave
      },
      locations
    )
    if (iconToSave.type === 'text') void live.refreshSingleIcon(bookmark)
  }

  if (!bookmark) {
    throw new AggressiveAiSaveError('save_failed', '书签写入失败', {
      detail: 'AI 已完成整理，但书签没有成功写入本地数据库。',
      recovery: '请确认书签库可写后重试。'
    })
  }

  const first = locations[0]
  if (first) {
    live.setSearch('')
    live.selectGroup(first.groupId, first.subGroupId)
  }

  const groupLabels = categories.map((c) =>
    c.subGroupName && c.subGroupName !== c.groupName ? `${c.groupName} / ${c.subGroupName}` : c.groupName
  )

  reportProgress('completed', '书签已写入，正在展示结果…')

  return {
    bookmark,
    title: bookmark.title || title,
    locations,
    categories,
    groupLabels,
    usedFallbackCollect,
    undo: previousBookmark
      ? { kind: 'updated', bookmark: previousBookmark, locations: previousLocations }
      : { kind: 'created' }
  }
}

/**
 * 撤销成功卡对应的那一次保存。
 * 新建书签进入回收站；已有书签恢复本次保存前的元信息与分组快照。
 */
export function undoAggressiveAiSave(result: AggressiveAiSaveResult): 'removed' | 'restored' | 'missing' {
  const store = useBookmarkStore.getState()
  const current = store.bookmarks.find((bookmark) => bookmark.id === result.bookmark.id)
  if (!current) return 'missing'

  if (result.undo.kind === 'created') {
    store.removeBookmark(current.id)
    return 'removed'
  }

  const previous = result.undo.bookmark
  store.updateBookmark(current.id, {
    title: previous.title,
    url: previous.url,
    desc: previous.desc,
    tags: [...(previous.tags || [])],
    icon: previous.icon ? { ...previous.icon } : undefined,
    pinned: previous.pinned,
    allowUniversal: previous.allowUniversal,
    lastUsed: previous.lastUsed,
    visits: previous.visits,
    isDeleted: previous.isDeleted
  })
  store.updateBookmarkLocations(
    current.id,
    result.undo.locations.map((location) => ({ ...location }))
  )
  return 'restored'
}
