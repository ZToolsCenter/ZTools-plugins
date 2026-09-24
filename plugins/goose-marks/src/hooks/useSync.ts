import { create } from 'zustand'
import { syncBookmarkLocations } from '@/hooks/useImportExport'
import { useBookmarkStore, TRASH_GROUP_ID } from '@/stores/bookmark'
import { utoolsStorage } from '@/lib/utoolsStorage'
import { filterRemoteChangesForShare, type RemoteSyncItem } from '@/lib/bookmarkSyncSafety'
import type { Bookmark, Group, SubGroup } from '@/types/bookmark'

/**
 * 多分享（shareId）增量同步：push 变更队列 + pull 远端变更（React 版）
 * --------------------------------------------------------------------------
 * 旧版 Vue 用模块级 ref 作为全局单例状态；React 等价用模块级 Zustand store
 * （useSync）。triggerSync / schedulePush 等动作挂在 store 上，组件用
 * useSync(selector) 订阅 isSyncing / syncError。
 *
 * applyRemoteChanges 等远端合并逻辑改为：取 store 的可变快照（groups/bookmarks 深拷贝），
 * 原地合并后通过 store.setData 一次性提交（等价旧版直接改 Pinia reactive state）。
 * store.setData / refreshMissingIcons 为业务阶段方法。
 */

const API_BASE_URL = import.meta.env.VITE_SHARE_API_URL || 'http://43.142.149.157:3001/api/sync'
const SYNC_STATE_STORAGE_KEY = 'goose-marks.sync-state'

type SyncItem = RemoteSyncItem

interface SchedulePushOptions {
  targetShareIds?: string[]
  previousShareIds?: string[]
}

type ShareAwareGroup = Group & { shareId?: string; sourceShareId?: string; orderIndex?: number }
type ShareAwareSubGroup = SubGroup & { shareId?: string; sourceShareId?: string; parentGroupId?: string }

// 远端合并操作的目标 store 契约（取自 bookmark store 的可变快照 + 提交方法）
type SyncStoreDraft = {
  groups: Group[]
  bookmarks: Bookmark[]
  activeGroupId: string
  activeSubGroupId: string
  setData: (state: Partial<{ groups: Group[]; bookmarks: Bookmark[]; activeGroupId: string; activeSubGroupId: string }>) => void
  refreshMissingIcons: () => void | Promise<void>
}

const normalizeShareIds = (ids: Array<string | null | undefined>): string[] => {
  const result = new Set<string>()
  ids.forEach((raw) => {
    const value = String(raw || '').trim()
    if (value) result.add(value)
  })
  return Array.from(result)
}

const clonePlain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const getEntityTs = (entity: { updatedAt?: number; createdAt?: number } | null | undefined): number => {
  const updatedAt = typeof entity?.updatedAt === 'number' ? entity.updatedAt : 0
  const createdAt = typeof entity?.createdAt === 'number' ? entity.createdAt : 0
  return Math.max(updatedAt, createdAt)
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const collectShareIds = (group?: ShareAwareGroup, sub?: ShareAwareSubGroup): string[] => {
  return normalizeShareIds([group?.shareId, group?.sourceShareId, sub?.shareId, sub?.sourceShareId])
}

const isLocationInShare = (
  groups: Group[],
  location: { groupId: string; subGroupId: string },
  shareId: string,
): boolean => {
  const group = groups.find((candidate) => candidate.id === location.groupId) as ShareAwareGroup | undefined
  const sub = group?.children.find((candidate) => candidate.id === location.subGroupId) as ShareAwareSubGroup | undefined
  return collectShareIds(group, sub).includes(shareId)
}

const indexedBookmarkLocations = (groups: Group[], bookmarkId: string) =>
  groups.flatMap((group) => group.children
    .filter((sub) => sub.bookmarkIds.includes(bookmarkId))
    .map((sub) => ({ groupId: group.id, subGroupId: sub.id })))

const findSubOwner = (
  draft: Pick<SyncStoreDraft, 'groups'>,
  subId: string
): { group: ShareAwareGroup; sub: ShareAwareSubGroup; groupIndex: number; subIndex: number } | null => {
  const groupIndex = draft.groups.findIndex((group: Group) => group.children.some((sub: SubGroup) => sub.id === subId))
  if (groupIndex === -1) return null

  const group = draft.groups[groupIndex] as ShareAwareGroup
  const subIndex = group.children.findIndex((sub: SubGroup) => sub.id === subId)
  if (subIndex === -1) return null

  return { group, sub: group.children[subIndex] as ShareAwareSubGroup, groupIndex, subIndex }
}

// 取 bookmark store 的可变快照（深拷贝 groups/bookmarks），供原地合并后提交
const takeSyncDraft = (): SyncStoreDraft => {
  const store = useBookmarkStore.getState() as any
  return {
    groups: clonePlain(store.groups),
    bookmarks: clonePlain(store.bookmarks),
    activeGroupId: store.activeGroupId,
    activeSubGroupId: store.activeSubGroupId,
    setData: store.setData,
    refreshMissingIcons: store.refreshMissingIcons
  }
}

const getRelevantShareIds = (draft: Pick<SyncStoreDraft, 'groups'>, item: SyncItem): string[] => {
  const shareIds = new Set<string>()

  if (item.itemType === 'bookmark') {
    const bookmark = item.content as Bookmark | null
    const locations = Array.isArray(bookmark?.locations) ? bookmark!.locations : []
    locations.forEach((loc) => {
      const group = draft.groups.find((g) => g.id === loc.groupId) as ShareAwareGroup | undefined
      if (!group) return
      const sub = group.children.find((s) => s.id === loc.subGroupId) as ShareAwareSubGroup | undefined
      collectShareIds(group, sub).forEach((id) => shareIds.add(id))
    })
  } else if (item.itemType === 'group') {
    const contentGroup = item.content as ShareAwareGroup | null
    collectShareIds(contentGroup || undefined).forEach((id) => shareIds.add(id))

    const group = draft.groups.find((g) => g.id === item.itemId) as ShareAwareGroup | undefined
    collectShareIds(group).forEach((id) => shareIds.add(id))
  } else if (item.itemType === 'subGroup') {
    const contentSub = item.content as ShareAwareSubGroup | null
    const parentGroupId = String(contentSub?.parentGroupId || '').trim()
    if (parentGroupId) {
      const parent = draft.groups.find((g) => g.id === parentGroupId) as ShareAwareGroup | undefined
      collectShareIds(parent, contentSub || undefined).forEach((id) => shareIds.add(id))
    }

    const owner = findSubOwner(draft, item.itemId)
    if (owner) {
      collectShareIds(owner.group, owner.sub).forEach((id) => shareIds.add(id))
    }
  }

  return normalizeShareIds(Array.from(shareIds))
}

interface SyncState {
  isSyncing: boolean
  syncError: string | null
  lastSyncTimes: Map<string, number>
  pendingQueues: Map<string, Map<string, SyncItem>>
  syncingShares: Set<string>

  triggerSync: (shareId: string) => Promise<void>
  schedulePush: (item: SyncItem, options?: SchedulePushOptions) => void
}

interface PersistedSyncState {
  schemaVersion: number
  lastSyncTimes: Array<[string, number]>
}

const syncItemKey = (item: SyncItem): string => `${item.itemType}:${item.itemId}`

const loadPersistedSyncState = (): Pick<SyncState, 'lastSyncTimes' | 'pendingQueues'> => {
  const empty = { lastSyncTimes: new Map<string, number>(), pendingQueues: new Map<string, Map<string, SyncItem>>() }
  const raw = utoolsStorage.getItem(SYNC_STATE_STORAGE_KEY)
  if (!raw) return empty

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedSyncState>
    const lastSyncTimes = new Map<string, number>()
    const pendingQueues = new Map<string, Map<string, SyncItem>>()

    if (parsed.schemaVersion !== 2) return empty

    if (Array.isArray(parsed.lastSyncTimes)) {
      parsed.lastSyncTimes.forEach(([shareId, timestamp]) => {
        const id = String(shareId || '').trim()
        if (id && isFiniteNumber(timestamp)) lastSyncTimes.set(id, timestamp)
      })
    }

    return { lastSyncTimes, pendingQueues }
  } catch {
    return empty
  }
}

const persistSyncState = (state: SyncState): void => {
  const payload: PersistedSyncState = {
    schemaVersion: 2,
    lastSyncTimes: Array.from(state.lastSyncTimes.entries()).filter(([, timestamp]) => isFiniteNumber(timestamp)),
  }

  utoolsStorage.setItem(SYNC_STATE_STORAGE_KEY, JSON.stringify(payload))
}

export const useSync = create<SyncState>((set, get) => {
  const persisted = loadPersistedSyncState()

  const enqueueForShare = (shareId: string, item: SyncItem) => {
    const queues = get().pendingQueues
    if (!queues.has(shareId)) queues.set(shareId, new Map())
    const queue = queues.get(shareId)!
    queue.set(syncItemKey(item), item)
    persistSyncState(get())

    console.log(`[Sync] Scheduled push for ${shareId}:`, item.itemId, item.itemType, item.isDeleted ? '(deleted)' : '')

    if (!get().syncingShares.has(shareId)) {
      setTimeout(() => get().triggerSync(shareId), 1000)
    }
  }

  return {
    isSyncing: false,
    syncError: null,
    lastSyncTimes: persisted.lastSyncTimes,
    pendingQueues: persisted.pendingQueues,
    syncingShares: new Set(),

    triggerSync: async (shareId: string) => {
      const syncingShares = get().syncingShares
      if (syncingShares.has(shareId) || !shareId) return
      syncingShares.add(shareId)
      set({ isSyncing: true, syncError: null })

      try {
        // 1. Push Phase
        const queue = get().pendingQueues.get(shareId)
        if (queue && queue.size > 0) {
          const itemsToPush = Array.from(queue.values())
          console.log('[Sync] Pushing', itemsToPush.length, 'items to', shareId)
          const pushRes = await fetch(`${API_BASE_URL}/${shareId}/push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: itemsToPush })
          })
          if (!pushRes.ok) throw new Error(`Push failed for ${shareId}`)
          queue.clear()
          get().pendingQueues.delete(shareId)
          persistSyncState(get())
        }

        // 2. Pull Phase
        const since = get().lastSyncTimes.get(shareId) || 0
        const pullRes = await fetch(`${API_BASE_URL}/${shareId}/pull?since=${since}`)
        if (!pullRes.ok) throw new Error(`Pull failed for ${shareId}`)

        const { items, lastUpdatedAt } = await pullRes.json()

        if (Array.isArray(items) && items.length > 0) {
          console.log('[Sync] Pulled', items.length, 'items from', shareId)
          applyRemoteChanges(shareId, items as SyncItem[])
          // 同步后刷新缺失图标（业务阶段方法）
          void useBookmarkStore.getState().refreshMissingIcons?.()
        }

        if (isFiniteNumber(lastUpdatedAt) && lastUpdatedAt > since) {
          get().lastSyncTimes.set(shareId, lastUpdatedAt)
          persistSyncState(get())
        }
      } catch (e: any) {
        console.error(`[Sync] Error for ${shareId}:`, e)
        set({ syncError: e.message })
      } finally {
        get().syncingShares.delete(shareId)
        set({ isSyncing: get().syncingShares.size > 0 })
      }
    },

    schedulePush: (item: SyncItem, options: SchedulePushOptions = {}) => {
      if (!item?.itemId) return

      const updatedAt = isFiniteNumber(item.updatedAt) ? item.updatedAt : Date.now()
      const normalizedItem: SyncItem = { ...item, updatedAt }

      const store = useBookmarkStore.getState()
      const targetShareIds = options.targetShareIds
        ? normalizeShareIds(options.targetShareIds)
        : getRelevantShareIds({ groups: store.groups }, normalizedItem)

      const previousShareIds = normalizeShareIds(options.previousShareIds || [])

      targetShareIds.forEach((shareId) => enqueueForShare(shareId, normalizedItem))

      // 处理“从某个分享中移出”的边界：向旧分享发送 tombstone
      if (previousShareIds.length > 0) {
        const removedShareIds = previousShareIds.filter((id) => !targetShareIds.includes(id))
        if (removedShareIds.length > 0) {
          const tombstone: SyncItem = {
            itemId: normalizedItem.itemId,
            itemType: normalizedItem.itemType,
            content: null,
            isDeleted: true,
            updatedAt,
            clientId: normalizedItem.clientId
          }
          removedShareIds.forEach((shareId) => enqueueForShare(shareId, tombstone))
        }
      }
    }
  }
})

const ensureActiveSelection = (draft: SyncStoreDraft) => {
  if (!Array.isArray(draft.groups) || draft.groups.length === 0) return

  let activeGroup = draft.groups.find((g: Group) => g.id === draft.activeGroupId)
  if (!activeGroup) {
    activeGroup = draft.groups.find((g: Group) => g.id !== TRASH_GROUP_ID) || draft.groups[0]
    draft.activeGroupId = activeGroup?.id || ''
  }

  if (!activeGroup) {
    draft.activeSubGroupId = ''
    return
  }

  if (!Array.isArray(activeGroup.children) || activeGroup.children.length === 0) {
    const now = Date.now()
    activeGroup.children = [
      { id: `sg-${now.toString(36)}`, name: '默认', bookmarkIds: [], createdAt: now, updatedAt: now }
    ]
  }

  const activeSub = activeGroup.children.find((sub: SubGroup) => sub.id === draft.activeSubGroupId)
  if (!activeSub) {
    draft.activeSubGroupId = activeGroup.children[0]?.id || ''
  }
}

const applyGroupOrderIndexes = (draft: SyncStoreDraft) => {
  const normalGroups = draft.groups.filter((group: Group) => group.id !== TRASH_GROUP_ID) as ShareAwareGroup[]
  const hasOrderIndex = normalGroups.some((group) => isFiniteNumber((group as any).orderIndex))
  if (!hasOrderIndex) return

  const sorted = [...normalGroups].sort((left, right) => {
    const leftOrder = isFiniteNumber((left as any).orderIndex) ? (left as any).orderIndex : Number.MAX_SAFE_INTEGER
    const rightOrder = isFiniteNumber((right as any).orderIndex) ? (right as any).orderIndex : Number.MAX_SAFE_INTEGER
    if (leftOrder !== rightOrder) return leftOrder - rightOrder
    return getEntityTs(left) - getEntityTs(right)
  })

  const trash = draft.groups.find((group: Group) => group.id === TRASH_GROUP_ID)
  draft.groups = trash ? [...sorted, trash] : sorted
}

// 应用远端变更：在 bookmark store 的可变快照上原地合并，最后一次性提交
const applyRemoteChanges = (shareId: string, items: SyncItem[]) => {
  const draft = takeSyncDraft()
  const acceptedItems = filterRemoteChangesForShare(draft.groups, items, shareId, draft.bookmarks)
  if (acceptedItems.length !== items.length) {
    console.warn(`[Sync] 已隔离 ${items.length - acceptedItems.length} 条越界远端变更:`, shareId)
  }
  if (acceptedItems.length === 0) return
  const orderedItems = [...acceptedItems].sort((left, right) => left.updatedAt - right.updatedAt)

  orderedItems
    .filter((item) => item.itemType === 'group')
    .forEach((item) => {
      const groupIndex = draft.groups.findIndex((group: Group) => group.id === item.itemId)

      if (item.isDeleted) {
        if (groupIndex !== -1) draft.groups.splice(groupIndex, 1)
        return
      }

      if (!item.content || typeof item.content !== 'object') return

      const rawGroup = clonePlain(item.content) as ShareAwareGroup
      const normalizedChildren = Array.isArray(rawGroup.children)
        ? rawGroup.children.map((rawSub) => {
            const sub = clonePlain(rawSub) as ShareAwareSubGroup
            sub.id = String(sub.id || '').trim() || `sg-${item.itemId}`
            sub.bookmarkIds = Array.from(
              new Set(
                (Array.isArray(sub.bookmarkIds) ? sub.bookmarkIds : [])
                  .map((id) => String(id || '').trim())
                  .filter(Boolean)
              )
            )
            sub.createdAt = getEntityTs(sub) || item.updatedAt
            sub.updatedAt = Math.max(getEntityTs(sub), item.updatedAt)
            sub.serverUpdatedAt = item.updatedAt
            return sub
          })
        : []

      const incomingGroup: ShareAwareGroup = {
        ...rawGroup,
        id: item.itemId,
        createdAt: getEntityTs(rawGroup) || item.updatedAt,
        updatedAt: Math.max(getEntityTs(rawGroup), item.updatedAt),
        serverUpdatedAt: item.updatedAt,
        children: normalizedChildren
      }

      if (groupIndex !== -1) {
        // group 同步只更新分组自身字段；子分组由 subGroup item 独立合并，
        // 禁止远端整包 children 覆盖本地刚新增的内容。
        incomingGroup.children = draft.groups[groupIndex].children
        draft.groups.splice(groupIndex, 1, incomingGroup)
      } else {
        const trashIndex = draft.groups.findIndex((group: Group) => group.id === TRASH_GROUP_ID)
        if (incomingGroup.id === TRASH_GROUP_ID || trashIndex === -1) {
          draft.groups.push(incomingGroup)
        } else {
          draft.groups.splice(trashIndex, 0, incomingGroup)
        }
      }
    })

  orderedItems
    .filter((item) => item.itemType === 'subGroup')
    .forEach((item) => {
      const owner = findSubOwner(draft, item.itemId)

      if (item.isDeleted) {
        if (owner) {
          owner.group.children.splice(owner.subIndex, 1)
          owner.group.updatedAt = Math.max(getEntityTs(owner.group), item.updatedAt)
        }
        return
      }

      if (!item.content || typeof item.content !== 'object') return

      const rawSub = clonePlain(item.content) as ShareAwareSubGroup
      const parentGroupId = String(rawSub.parentGroupId || owner?.group.id || '').trim()
      if (!parentGroupId) return

      let targetGroup = draft.groups.find((group: Group) => group.id === parentGroupId) as ShareAwareGroup | undefined
      if (!targetGroup) {
        const now = item.updatedAt
        const createdGroup: ShareAwareGroup = {
          id: parentGroupId,
          name: '同步分组',
          createdAt: now,
          updatedAt: now,
          children: []
        }
        const trashIndex = draft.groups.findIndex((group: Group) => group.id === TRASH_GROUP_ID)
        if (trashIndex === -1) {
          draft.groups.push(createdGroup)
        } else {
          draft.groups.splice(trashIndex, 0, createdGroup)
        }
        targetGroup = createdGroup
      }

      const incomingSub: ShareAwareSubGroup = {
        ...rawSub,
        id: item.itemId,
        bookmarkIds: Array.from(
          new Set(
            (Array.isArray(rawSub.bookmarkIds) ? rawSub.bookmarkIds : [])
              .map((id) => String(id || '').trim())
              .filter(Boolean)
          )
        ),
        createdAt: getEntityTs(rawSub) || item.updatedAt,
        updatedAt: Math.max(getEntityTs(rawSub), item.updatedAt),
        serverUpdatedAt: item.updatedAt,
        parentGroupId
      }

      if (owner && owner.group.id !== targetGroup.id) {
        owner.group.children.splice(owner.subIndex, 1)
        owner.group.updatedAt = Math.max(getEntityTs(owner.group), item.updatedAt)
      }

      const targetSubIndex = targetGroup.children.findIndex((sub: SubGroup) => sub.id === item.itemId)
      if (targetSubIndex !== -1) {
        targetGroup.children.splice(targetSubIndex, 1, incomingSub)
      } else {
        targetGroup.children.push(incomingSub)
      }
      targetGroup.updatedAt = Math.max(getEntityTs(targetGroup), item.updatedAt)
    })

  orderedItems
    .filter((item) => item.itemType === 'bookmark')
    .forEach((item) => {
      const existingIndex = draft.bookmarks.findIndex((bookmark: Bookmark) => bookmark.id === item.itemId)

      if (item.isDeleted) {
        const existing = existingIndex === -1 ? null : draft.bookmarks[existingIndex]
        const localLocations = Array.isArray(existing?.locations) && existing.locations.length > 0
          ? existing.locations
          : indexedBookmarkLocations(draft.groups, item.itemId)
        const remainingLocations = localLocations.filter((location) =>
          !isLocationInShare(draft.groups, location, shareId))

        draft.groups.forEach((group: Group) => {
          group.children.forEach((sub: SubGroup) => {
            if (!collectShareIds(group as ShareAwareGroup, sub as ShareAwareSubGroup).includes(shareId)) return
            sub.bookmarkIds = sub.bookmarkIds.filter((id) => id !== item.itemId)
          })
        })
        if (existingIndex !== -1) {
          if (remainingLocations.length > 0) {
            draft.bookmarks.splice(existingIndex, 1, {
              ...existing!,
              locations: remainingLocations,
              updatedAt: Math.max(getEntityTs(existing), item.updatedAt),
              serverUpdatedAt: item.updatedAt,
            })
          } else {
            draft.bookmarks.splice(existingIndex, 1)
          }
        }
        return
      }

      if (!item.content || typeof item.content !== 'object') return

      const incomingBookmark = clonePlain(item.content) as Bookmark
      const existingBookmark = existingIndex === -1 ? null : draft.bookmarks[existingIndex]
      const localLocations = Array.isArray(existingBookmark?.locations) && existingBookmark.locations.length > 0
        ? existingBookmark.locations
        : indexedBookmarkLocations(draft.groups, item.itemId)
      const preservedLocations = localLocations.filter((location) =>
        !isLocationInShare(draft.groups, location, shareId))
      const incomingLocations = (Array.isArray(incomingBookmark.locations) ? incomingBookmark.locations : [])
        .filter((location) => isLocationInShare(draft.groups, location, shareId))
      incomingBookmark.id = item.itemId
      incomingBookmark.createdAt = getEntityTs(incomingBookmark) || item.updatedAt
      incomingBookmark.updatedAt = Math.max(getEntityTs(incomingBookmark), item.updatedAt)
      incomingBookmark.serverUpdatedAt = item.updatedAt
      incomingBookmark.locations = Array.from(
        new Map([...preservedLocations, ...incomingLocations]
          .map((location) => [`${location.groupId}:${location.subGroupId}`, location])).values(),
      )

      if (existingIndex !== -1) {
        draft.bookmarks.splice(existingIndex, 1, incomingBookmark)
      } else {
        draft.bookmarks.push(incomingBookmark)
      }

      // 使用书签 locations 反向修正子分组索引，避免“只更新书签不更新分组”时丢失可见性。
      draft.groups.forEach((group: Group) => {
        group.children.forEach((sub: SubGroup) => {
          if (!collectShareIds(group as ShareAwareGroup, sub as ShareAwareSubGroup).includes(shareId)) return
          sub.bookmarkIds = sub.bookmarkIds.filter((id) => id !== incomingBookmark.id)
        })
      })

      incomingBookmark.locations.forEach((loc) => {
        const group = draft.groups.find((g: Group) => g.id === loc.groupId)
        const sub = group?.children.find((s: SubGroup) => s.id === loc.subGroupId)
        if (!sub) return
        if (!sub.bookmarkIds.includes(incomingBookmark.id)) {
          sub.bookmarkIds.push(incomingBookmark.id)
        }
      })
    })

  syncBookmarkLocations(draft.groups, draft.bookmarks)
  applyGroupOrderIndexes(draft)
  ensureActiveSelection(draft)

  // 一次性提交合并结果到 bookmark store（业务阶段 setData 方法）
  draft.setData({
    groups: draft.groups,
    bookmarks: draft.bookmarks,
    activeGroupId: draft.activeGroupId,
    activeSubGroupId: draft.activeSubGroupId
  })
}
