import type { Bookmark, Group, SubGroup, BookmarkLocation, IconSource } from '@/types/bookmark'
import type { ParseResult, ParsedFolder, ParsedBookmark } from '@/lib/htmlBookmarkParser'
import { TRASH_GROUP_ID } from '@/stores/bookmark'

type ImportData = { groups: Group[]; bookmarks: Bookmark[] }
type ImportMode = 'overwrite' | 'merge'

type JsonImportSource = 'goose-marks' | 'url-wizard'

type JsonImportSuccess = {
  ok: true
  source: JsonImportSource
  sourceLabel: string
  data: ImportData
  warnings: string[]
  stats: {
    groups: number
    bookmarks: number
    skipped: number
  }
}

type JsonImportError = {
  ok: false
  message: string
}

export type JsonImportResult = JsonImportSuccess | JsonImportError

// 导入目标 store 的结构契约（Zustand 版）。原 Pinia $patch 改为 setData，
// 由业务阶段的 bookmark store 提供（等价批量 set 数据契约字段）。
type BookmarkStoreLike = {
  groups: Group[]
  bookmarks: Bookmark[]
  activeGroupId: string
  activeSubGroupId: string
  setData: (state: Partial<{
    groups: Group[]
    bookmarks: Bookmark[]
    activeGroupId: string
    activeSubGroupId: string
  }>) => void
  selectGroup: (groupId: string, subId?: string) => void
}

type UrlWizardCategory = {
  id: string
  name: string
  pid: string
}

type UrlWizardFolderNode = {
  name: string
  bookmarks: ParsedBookmark[]
}

type UrlWizardResolveResult = {
  groupKey: string
  groupName: string
  subKey: string
  subName: string
}

type ApplyImportSummary = {
  before: {
    groups: number
    bookmarks: number
  }
  after: {
    groups: number
    bookmarks: number
  }
  added: {
    groups: number
    bookmarks: number
  }
}

const DEFAULT_GROUP_ID = 'g-default'
const DEFAULT_SUB_ID = 'sg-default'
const DEFAULT_GROUP_NAME = '默认'
const DEFAULT_SUB_NAME = '未分类'
const TRASH_SUB_ID = 'sg-trash'
const MAX_CATEGORY_DEPTH = 10

const uid = (prefix = 'id') => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

const asNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

const toTs = (value: unknown, fallback: number) => {
  const parsed = asNumber(value)
  // 允许 0 作为合法时间戳（如 Unix epoch），只排除 null、非有限数、负数
  if (parsed === null || !Number.isFinite(parsed) || parsed < 0) return fallback
  return parsed < 1e12 ? Math.round(parsed * 1000) : Math.round(parsed)
}

const sanitizeIdPart = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_')

const cloneImportData = (data: ImportData): ImportData => ({
  groups: JSON.parse(JSON.stringify(data.groups)) as Group[],
  bookmarks: JSON.parse(JSON.stringify(data.bookmarks)) as Bookmark[]
})

const isSupportedBookmarkUrl = (url: string): boolean => {
  const value = url.trim()
  if (!value) return false
  if (/^https?:\/\//i.test(value)) return true

  // 明确拒绝其他 scheme（如 file://、javascript: 等）
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return false

  // 无协议写法：域名/localhost + 可选路径（支持模板变量）
  if (/\s/.test(value)) return false
  if (/^localhost(?::\d+)?(?:\/|$|\?)/i.test(value)) return true
  if (/^(?:[\w-]+\.)+[\w-]{2,}(?::\d+)?(?:\/|$|\?)/i.test(value)) return true
  return false
}

const sanitizeIcon = (rawIcon: unknown, fallbackText: string): IconSource | undefined => {
  const icon = asObject(rawIcon)
  if (!icon) return undefined

  const type = asNonEmptyString(icon.type)
  if (!type) return undefined

  if (type === 'file') {
    const path = asNonEmptyString(icon.path)
    if (!path) return undefined
    const hash = asNonEmptyString(icon.hash) ?? undefined
    const fetchedAt = asNumber(icon.fetchedAt) ?? undefined
    const bgColor = asNonEmptyString(icon.bgColor) ?? undefined
    return { type: 'file', path, hash, fetchedAt, bgColor }
  }

  if (type === 'remote') {
    const src = asNonEmptyString(icon.src)
    if (!src) return undefined
    const cache = asNonEmptyString(icon.cache) ?? undefined
    const fetchedAt = asNumber(icon.fetchedAt) ?? undefined
    const bgColor = asNonEmptyString(icon.bgColor) ?? undefined
    return { type: 'remote', src, cache, fetchedAt, bgColor }
  }

  if (type === 'custom') {
    const data = asNonEmptyString(icon.data)
    if (!data) return undefined
    const bgColor = asNonEmptyString(icon.bgColor) ?? undefined
    return { type: 'custom', data, bgColor }
  }

  if (type === 'text') {
    const value = asNonEmptyString(icon.value) || asNonEmptyString(icon.text) || fallbackText
    const bgColor = asNonEmptyString(icon.bgColor) ?? undefined
    return { type: 'text', value: value.slice(0, 4), bgColor }
  }

  // 网址精灵 icon.type = image 时，降级为文本图标
  const text = asNonEmptyString(icon.text)
  if (text) {
    return { type: 'text', value: text.slice(0, 4) }
  }

  return undefined
}

const ensureBaseGroups = (groups: Group[], now = Date.now()) => {
  let defaultGroup = groups.find(g => g.id === DEFAULT_GROUP_ID)
  if (!defaultGroup) {
    defaultGroup = groups.find(g => g.id !== TRASH_GROUP_ID)
  }
  if (!defaultGroup) {
    defaultGroup = {
      id: DEFAULT_GROUP_ID,
      name: DEFAULT_GROUP_NAME,
      createdAt: now,
      updatedAt: now,
      children: []
    }
    groups.unshift(defaultGroup)
  }
  if (!Array.isArray(defaultGroup.children)) {
    defaultGroup.children = []
  }
  if (!defaultGroup.children.length) {
    defaultGroup.children.push({
      id: DEFAULT_SUB_ID,
      name: DEFAULT_SUB_NAME,
      bookmarkIds: [],
      createdAt: now,
      updatedAt: now
    })
  }

  let trash = groups.find(g => g.id === TRASH_GROUP_ID)
  if (!trash) {
    trash = {
      id: TRASH_GROUP_ID,
      name: '回收站',
      createdAt: now,
      updatedAt: now,
      children: []
    }
    groups.push(trash)
  }
  if (!Array.isArray(trash.children)) {
    trash.children = []
  }
  if (!trash.children.length) {
    trash.children.push({
      id: TRASH_SUB_ID,
      name: '已删除',
      bookmarkIds: [],
      createdAt: now,
      updatedAt: now
    })
  }
}

export const syncBookmarkLocations = (groups: Group[], bookmarks: Bookmark[]) => {
  const now = Date.now()
  ensureBaseGroups(groups, now)

  const bookmarkById = new Map(bookmarks.map(item => [item.id, item]))
  const locationsMap = new Map<string, BookmarkLocation[]>()

  groups.forEach(group => {
    group.children = (group.children || []).filter(Boolean)
    group.children.forEach(sub => {
      const deduped = Array.from(new Set((sub.bookmarkIds || []).filter(id => bookmarkById.has(id))))
      sub.bookmarkIds = deduped
      deduped.forEach(bookmarkId => {
        const existing = locationsMap.get(bookmarkId) || []
        existing.push({ groupId: group.id, subGroupId: sub.id })
        locationsMap.set(bookmarkId, existing)
      })
    })
    if (!group.children.length) {
      group.children.push({
        id: uid('sg'),
        name: DEFAULT_SUB_NAME,
        bookmarkIds: [],
        createdAt: now,
        updatedAt: now
      })
    }
  })

  const firstTargetGroup = groups.find(g => g.id !== TRASH_GROUP_ID) || groups[0]
  const firstTargetSub = firstTargetGroup.children[0]

  bookmarks.forEach(bookmark => {
    const locations = locationsMap.get(bookmark.id)
    if (locations && locations.length > 0) {
      bookmark.locations = locations
      return
    }

    if (!firstTargetSub.bookmarkIds.includes(bookmark.id)) {
      firstTargetSub.bookmarkIds.push(bookmark.id)
    }
    bookmark.locations = [{ groupId: firstTargetGroup.id, subGroupId: firstTargetSub.id }]
  })
}

const mergeImportData = (target: ImportData, incoming: ImportData) => {
  const existingBookmarkIds = new Set(target.bookmarks.map(item => item.id))
  incoming.bookmarks.forEach(bookmark => {
    if (!existingBookmarkIds.has(bookmark.id)) {
      target.bookmarks.push(bookmark)
      existingBookmarkIds.add(bookmark.id)
    }
  })

  const groupById = new Map(target.groups.map(group => [group.id, group]))
  incoming.groups.forEach(group => {
    const targetGroup = groupById.get(group.id)
    if (!targetGroup) {
      target.groups.push(group)
      groupById.set(group.id, group)
      return
    }

    const subById = new Map(targetGroup.children.map(sub => [sub.id, sub]))
    group.children.forEach(sub => {
      const targetSub = subById.get(sub.id)
      if (!targetSub) {
        targetGroup.children.push(sub)
        subById.set(sub.id, sub)
        return
      }
      const existingIds = new Set(targetSub.bookmarkIds)
      sub.bookmarkIds.forEach(bookmarkId => {
        if (!existingIds.has(bookmarkId)) {
          targetSub.bookmarkIds.push(bookmarkId)
          existingIds.add(bookmarkId)
        }
      })
    })
    targetGroup.updatedAt = Math.max(targetGroup.updatedAt || 0, group.updatedAt || 0)
  })
}

const ensureStoreSelection = (store: BookmarkStoreLike) => {
  if (!store.groups.length) return

  const activeGroup = store.groups.find(group => group.id === store.activeGroupId)
  const activeSub = activeGroup?.children.find(sub => sub.id === store.activeSubGroupId)
  if (activeGroup && activeSub) return

  const fallbackGroup = store.groups.find(group => group.id !== TRASH_GROUP_ID) || store.groups[0]
  const fallbackSub = fallbackGroup.children[0]
  store.selectGroup(fallbackGroup.id, fallbackSub?.id)
}

export const applyImportDataToStore = (
  store: BookmarkStoreLike,
  incomingData: ImportData,
  mode: ImportMode
): ApplyImportSummary => {
  const before = {
    groups: store.groups.length,
    bookmarks: store.bookmarks.length
  }

  // afterData 引用合并后的实际数据，用于准确统计新增数——
  // store.setData 是同步的但 store 对象是调用时的旧快照，setData 后读 store.groups/bookmarks 仍是旧值。
  let afterData: ImportData

  if (mode === 'overwrite') {
    const cloned = cloneImportData(incomingData)
    syncBookmarkLocations(cloned.groups, cloned.bookmarks)
    afterData = cloned
    store.setData({
      groups: cloned.groups,
      bookmarks: cloned.bookmarks
    })
  } else {
    // merge 模式：先拷贝 store 当前数据作为 target，合并后通过 setData 提交，避免原地 mutate 绕过 zustand
    const target: ImportData = {
      groups: JSON.parse(JSON.stringify(store.groups)) as Group[],
      bookmarks: JSON.parse(JSON.stringify(store.bookmarks)) as Bookmark[]
    }
    const cloned = cloneImportData(incomingData)
    mergeImportData(target, cloned)
    syncBookmarkLocations(target.groups, target.bookmarks)
    afterData = target
    store.setData({
      groups: target.groups,
      bookmarks: target.bookmarks
    })
  }

  ensureStoreSelection(store)

  const after = {
    groups: afterData.groups.length,
    bookmarks: afterData.bookmarks.length
  }

  return {
    before,
    after,
    added: {
      groups: Math.max(0, after.groups - before.groups),
      bookmarks: Math.max(0, after.bookmarks - before.bookmarks)
    }
  }
}

const normalizeSystemBackup = (payload: Record<string, unknown>): JsonImportSuccess => {
  const now = Date.now()
  const warnings: string[] = []
  let skipped = 0

  const rawBookmarks = Array.isArray(payload.bookmarks) ? payload.bookmarks : []
  const rawGroups = Array.isArray(payload.groups) ? payload.groups : []

  const bookmarks: Bookmark[] = []
  const bookmarkById = new Map<string, Bookmark>()

  rawBookmarks.forEach((item) => {
    const record = asObject(item)
    if (!record) {
      skipped++
      return
    }

    const rawUrl = asNonEmptyString(record.url)
    if (!rawUrl || !isSupportedBookmarkUrl(rawUrl)) {
      skipped++
      return
    }

    let id = asNonEmptyString(record.id) || uid('bm')
    if (bookmarkById.has(id)) {
      warnings.push(`检测到重复书签 ID（${id}），已忽略后续重复项`)
      skipped++
      return
    }

    const title = asNonEmptyString(record.title) || rawUrl
    const createdAt = toTs(record.createdAt, now)
    const updatedAt = toTs(record.updatedAt, createdAt)
    const tags = Array.isArray(record.tags)
      ? record.tags.map(value => asNonEmptyString(value)).filter((value): value is string => !!value)
      : []

    const bookmark: Bookmark = {
      id,
      title,
      url: rawUrl,
      desc: asNonEmptyString(record.desc) || '',
      tags,
      icon: sanitizeIcon(record.icon, title),
      pinned: !!record.pinned,
      allowUniversal: !!record.allowUniversal,
      iconMatchedAt: asNumber(record.iconMatchedAt) ?? undefined,
      iconMatchFailedAt: asNumber(record.iconMatchFailedAt) ?? undefined,
      iconMatchFailedReason: asNonEmptyString(record.iconMatchFailedReason) ?? undefined,
      createdAt,
      updatedAt,
      isDeleted: !!record.isDeleted
    }

    bookmarkById.set(id, bookmark)
    bookmarks.push(bookmark)
  })

  const groups: Group[] = []
  const groupById = new Map<string, Group>()
  rawGroups.forEach(item => {
    const record = asObject(item)
    if (!record) return

    const groupId = asNonEmptyString(record.id) || uid('g')
    const groupName = asNonEmptyString(record.name) || '未命名分组'
    const createdAt = toTs(record.createdAt, now)
    const updatedAt = toTs(record.updatedAt, createdAt)
    const childrenRaw = Array.isArray(record.children) ? record.children : []

    const group: Group = groupById.get(groupId) || {
      id: groupId,
      name: groupName,
      children: [],
      createdAt,
      updatedAt,
      isDeleted: !!record.isDeleted
    }

    const subById = new Map(group.children.map(sub => [sub.id, sub]))
    childrenRaw.forEach(subItem => {
      const subRecord = asObject(subItem)
      if (!subRecord) return
      const subId = asNonEmptyString(subRecord.id) || uid('sg')
      const subName = asNonEmptyString(subRecord.name) || DEFAULT_SUB_NAME
      const subCreatedAt = toTs(subRecord.createdAt, now)
      const subUpdatedAt = toTs(subRecord.updatedAt, subCreatedAt)
      const rawBookmarkIds = Array.isArray(subRecord.bookmarkIds) ? subRecord.bookmarkIds : []
      const bookmarkIds = Array.from(new Set(
        rawBookmarkIds
          .map(value => asNonEmptyString(value))
          .filter((value): value is string => !!value && bookmarkById.has(value))
      ))

      const existing = subById.get(subId)
      if (existing) {
        const existingIds = new Set(existing.bookmarkIds)
        bookmarkIds.forEach(bookmarkId => {
          if (!existingIds.has(bookmarkId)) existing.bookmarkIds.push(bookmarkId)
        })
        existing.updatedAt = Math.max(existing.updatedAt || 0, subUpdatedAt)
        return
      }

      const sub: SubGroup = {
        id: subId,
        name: subName,
        bookmarkIds,
        createdAt: subCreatedAt,
        updatedAt: subUpdatedAt,
        isDeleted: !!subRecord.isDeleted
      }
      group.children.push(sub)
      subById.set(sub.id, sub)
    })

    if (!group.children.length) {
      group.children.push({
        id: uid('sg'),
        name: DEFAULT_SUB_NAME,
        bookmarkIds: [],
        createdAt: now,
        updatedAt: now
      })
    }

    if (!groupById.has(groupId)) {
      groups.push(group)
      groupById.set(groupId, group)
    }
  })

  ensureBaseGroups(groups, now)
  syncBookmarkLocations(groups, bookmarks)

  return {
    ok: true,
    source: 'goose-marks',
    sourceLabel: '鹅的书签备份',
    data: { groups, bookmarks },
    warnings,
    stats: {
      groups: groups.length,
      bookmarks: bookmarks.length,
      skipped
    }
  }
}

const isUrlWizardPayload = (payload: Record<string, unknown>) => {
  const db = payload.db
  if (!Array.isArray(db)) return false
  return db.some(item => {
    const record = asObject(item)
    if (!record) return false
    const id = asNonEmptyString(record._id) || ''
    if (id.startsWith('cat_') || id.startsWith('web_')) return true
    return Array.isArray(record.catIds) && typeof record.url === 'string'
  })
}

const resolveUrlWizardCategory = (
  catId: string,
  categoryById: Map<string, UrlWizardCategory>,
  warnings: string[]
): UrlWizardResolveResult => {
  if (catId === 'cat@dustbin') {
    return {
      groupKey: `group:${TRASH_GROUP_ID}`,
      groupName: '回收站',
      subKey: `sub:${TRASH_SUB_ID}`,
      subName: '已删除'
    }
  }

  if (!catId || catId === 'cat@default') {
    return {
      groupKey: `group:${DEFAULT_GROUP_ID}`,
      groupName: DEFAULT_GROUP_NAME,
      subKey: `sub:${DEFAULT_SUB_ID}`,
      subName: DEFAULT_SUB_NAME
    }
  }

  const visited = new Set<string>()
  const chain: UrlWizardCategory[] = []
  let current = categoryById.get(catId)
  let depth = 0

  while (current && depth < MAX_CATEGORY_DEPTH) {
    if (visited.has(current.id)) break
    visited.add(current.id)
    chain.unshift(current)
    if (!current.pid || !current.pid.startsWith('cat_')) break
    current = categoryById.get(current.pid)
    depth++
  }

  if (!chain.length) {
    warnings.push(`检测到未知分类 ID（${catId}），已归入“${DEFAULT_GROUP_NAME} / ${DEFAULT_SUB_NAME}”`)
    return {
      groupKey: `group:${DEFAULT_GROUP_ID}`,
      groupName: DEFAULT_GROUP_NAME,
      subKey: `sub:${DEFAULT_SUB_ID}`,
      subName: DEFAULT_SUB_NAME
    }
  }

  const root = chain[0]
  const subPath = chain.slice(1).map(item => item.name)
  return {
    groupKey: `group:wzj-g-${sanitizeIdPart(root.id)}`,
    groupName: root.name,
    subKey: subPath.length
      ? `sub:wzj-s-${sanitizeIdPart(chain[chain.length - 1].id)}`
      : `sub:wzj-s-${sanitizeIdPart(root.id)}-default`,
    subName: subPath.length ? subPath.join(' / ') : DEFAULT_SUB_NAME
  }
}

const parseTimestampFromId = (id: string): number | null => {
  const match = id.match(/_(\d{10,})$/)
  if (!match) return null
  const raw = Number(match[1])
  if (!Number.isFinite(raw) || raw <= 0) return null
  return raw < 1e12 ? Math.round(raw * 1000) : Math.round(raw)
}

const normalizeUrlWizardPayload = (payload: Record<string, unknown>): JsonImportSuccess | JsonImportError => {
  const db = Array.isArray(payload.db) ? payload.db : []
  const now = Date.now()
  const warnings: string[] = []

  const categoryById = new Map<string, UrlWizardCategory>()
  db.forEach(item => {
    const record = asObject(item)
    if (!record) return
    const id = asNonEmptyString(record._id)
    if (!id || !id.startsWith('cat_')) return
    const name = asNonEmptyString(record.label) || '未命名分类'
    const pid = asNonEmptyString(record.pid) || ''
    categoryById.set(id, { id, name, pid })
  })

  const groupByKey = new Map<string, Group>()
  const subByKey = new Map<string, SubGroup>()
  const bookmarks: Bookmark[] = []
  const bookmarkIds = new Set<string>()
  const dedupeUrlInSub = new Set<string>()
  let skipped = 0

  const getOrCreateGroup = (key: string, name: string): Group => {
    const cached = groupByKey.get(key)
    if (cached) return cached
    const id = key.startsWith('group:') ? key.slice(6) : `wzj-g-${uid('group')}`
    const group: Group = {
      id,
      name,
      children: [],
      createdAt: now,
      updatedAt: now
    }
    groupByKey.set(key, group)
    return group
  }

  const getOrCreateSub = (group: Group, key: string, name: string): SubGroup => {
    const mapKey = `${group.id}|${key}`
    const cached = subByKey.get(mapKey)
    if (cached) return cached
    const id = key.startsWith('sub:') ? key.slice(4) : `wzj-s-${uid('sub')}`
    const sub: SubGroup = {
      id,
      name,
      bookmarkIds: [],
      createdAt: now,
      updatedAt: now
    }
    group.children.push(sub)
    subByKey.set(mapKey, sub)
    return sub
  }

  db.forEach(item => {
    const record = asObject(item)
    if (!record) return
    const rawId = asNonEmptyString(record._id)
    if (!rawId || !rawId.startsWith('web_')) return

    const rawUrl = asNonEmptyString(record.url)
    if (!rawUrl || !isSupportedBookmarkUrl(rawUrl)) {
      skipped++
      return
    }

    const catIds = Array.isArray(record.catIds)
      ? record.catIds.map(value => asNonEmptyString(value)).filter((value): value is string => !!value)
      : []
    const targetCatId = catIds[0] || 'cat@default'
    const resolved = resolveUrlWizardCategory(targetCatId, categoryById, warnings)
    const group = getOrCreateGroup(resolved.groupKey, resolved.groupName)
    const sub = getOrCreateSub(group, resolved.subKey, resolved.subName)

    const bookmarkId = `wzj-b-${sanitizeIdPart(rawId)}`
    if (bookmarkIds.has(bookmarkId)) {
      skipped++
      return
    }

    const dedupeKey = `${sub.id}|${rawUrl}`
    if (dedupeUrlInSub.has(dedupeKey)) {
      skipped++
      return
    }

    const title = asNonEmptyString(record.title) || rawUrl
    const fallbackTs = parseTimestampFromId(rawId) || now
    const icon = sanitizeIcon(record.icon, title)

    const tags: string[] = []
    if (record.isOften === true) tags.push('常用')
    if (record.isFly === true) tags.push('快捷')

    const bookmark: Bookmark = {
      id: bookmarkId,
      title,
      url: rawUrl,
      desc: asNonEmptyString(record.desc) || '',
      tags,
      icon,
      createdAt: fallbackTs,
      updatedAt: fallbackTs
    }

    bookmarkIds.add(bookmarkId)
    dedupeUrlInSub.add(dedupeKey)
    bookmarks.push(bookmark)
    sub.bookmarkIds.push(bookmarkId)
  })

  const groups = Array.from(groupByKey.values())
  if (!bookmarks.length) {
    return {
      ok: false,
      message: '未在网址精灵 data.json 中找到可导入的网址数据（仅支持 http/https）'
    }
  }

  ensureBaseGroups(groups, now)
  syncBookmarkLocations(groups, bookmarks)

  return {
    ok: true,
    source: 'url-wizard',
    sourceLabel: '网址精灵 data.json',
    data: { groups, bookmarks },
    warnings: Array.from(new Set(warnings)),
    stats: {
      groups: groups.length,
      bookmarks: bookmarks.length,
      skipped
    }
  }
}

export const parseJsonImportText = (text: string): JsonImportResult => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {
      ok: false,
      message: 'JSON 解析失败，请检查文件格式是否完整'
    }
  }

  const payload = asObject(parsed)
  if (!payload) {
    return {
      ok: false,
      message: '无效的 JSON 结构'
    }
  }

  if (Array.isArray(payload.groups) && Array.isArray(payload.bookmarks)) {
    return normalizeSystemBackup(payload)
  }

  if (isUrlWizardPayload(payload)) {
    return normalizeUrlWizardPayload(payload)
  }

  return {
    ok: false,
    message: '暂不支持该 JSON 格式。请使用鹅的书签备份 JSON 或网址精灵导出的 data.json'
  }
}

export const flattenHtmlFolders = (folder: ParsedFolder, pathPrefix = ''): UrlWizardFolderNode[] => {
  const result: UrlWizardFolderNode[] = []
  const currentName = pathPrefix ? `${pathPrefix}/${folder.name}` : folder.name

  if (folder.bookmarks.length > 0) {
    result.push({ name: currentName, bookmarks: folder.bookmarks })
  }

  folder.children.forEach(child => {
    result.push(...flattenHtmlFolders(child, currentName))
  })

  return result
}

export const importHtmlBookmarks = (parsed: ParseResult): ImportData => {
  const now = Date.now()
  const groups: Group[] = []
  const bookmarks: Bookmark[] = []

  const appendBookmark = (groupId: string, subId: string, item: ParsedBookmark) => {
    const id = uid('bm')
    bookmarks.push({
      id,
      title: item.title || item.url,
      url: item.url,
      desc: '',
      tags: [],
      createdAt: item.addDate || now,
      updatedAt: now,
      locations: [{ groupId, subGroupId: subId }]
    })
    return id
  }

  if (parsed.flatBookmarks.length > 0) {
    const groupId = uid('g')
    const subId = uid('sg')
    const ids = parsed.flatBookmarks
      .filter(bookmark => bookmark.folderPath.length === 0 && isSupportedBookmarkUrl(bookmark.url))
      .map(bookmark => appendBookmark(groupId, subId, bookmark))
    if (ids.length > 0) {
      groups.push({
        id: groupId,
        name: '导入书签',
        createdAt: now,
        updatedAt: now,
        children: [
          {
            id: subId,
            name: DEFAULT_SUB_NAME,
            bookmarkIds: ids,
            createdAt: now,
            updatedAt: now
          }
        ]
      })
    }
  }

  parsed.folders.forEach(folder => {
    const groupId = uid('g')
    const children: SubGroup[] = []
    const rootSubId = uid('sg')
    const rootIds = folder.bookmarks
      .filter(bookmark => isSupportedBookmarkUrl(bookmark.url))
      .map(bookmark => appendBookmark(groupId, rootSubId, bookmark))

    if (rootIds.length > 0) {
      children.push({
        id: rootSubId,
        name: DEFAULT_SUB_NAME,
        bookmarkIds: rootIds,
        createdAt: now,
        updatedAt: now
      })
    }

    folder.children.forEach(child => {
      const flatList = flattenHtmlFolders(child)
      flatList.forEach(flat => {
        const subId = uid('sg')
        const ids = flat.bookmarks
          .filter(bookmark => isSupportedBookmarkUrl(bookmark.url))
          .map(bookmark => appendBookmark(groupId, subId, bookmark))
        if (ids.length > 0) {
          children.push({
            id: subId,
            name: flat.name,
            bookmarkIds: ids,
            createdAt: now,
            updatedAt: now
          })
        }
      })
    })

    if (!children.length) {
      children.push({
        id: uid('sg'),
        name: DEFAULT_SUB_NAME,
        bookmarkIds: [],
        createdAt: now,
        updatedAt: now
      })
    }

    groups.push({
      id: groupId,
      name: folder.name || '导入分组',
      createdAt: now,
      updatedAt: now,
      children
    })
  })

  ensureBaseGroups(groups, now)
  syncBookmarkLocations(groups, bookmarks)
  return { groups, bookmarks }
}
