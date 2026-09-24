import type { Bookmark, Group, SubGroup } from '@/types/bookmark'

export interface RemoteSyncItem {
  itemId: string
  itemType: 'bookmark' | 'group' | 'subGroup'
  content: unknown
  isDeleted: boolean
  updatedAt: number
  clientId?: string
}

type SharedGroup = Group & { shareId?: string; sourceShareId?: string }
type SharedSubGroup = SubGroup & { shareId?: string; sourceShareId?: string; parentGroupId?: string }

const addShareIds = (target: Set<string>, value?: { shareId?: string; sourceShareId?: string } | null) => {
  const shareId = String(value?.shareId || '').trim()
  const sourceShareId = String(value?.sourceShareId || '').trim()
  if (shareId) target.add(shareId)
  if (sourceShareId) target.add(sourceShareId)
}

const entityTimestamp = (value?: { updatedAt?: number; createdAt?: number; serverUpdatedAt?: number } | null): number =>
  Math.max(
    typeof value?.updatedAt === 'number' ? value.updatedAt : 0,
    typeof value?.createdAt === 'number' ? value.createdAt : 0,
    typeof value?.serverUpdatedAt === 'number' ? value.serverUpdatedAt : 0,
  )

const findLocalEntity = (
  groups: Group[],
  bookmarks: Bookmark[],
  item: RemoteSyncItem,
): { updatedAt?: number; createdAt?: number; serverUpdatedAt?: number } | null => {
  if (item.itemType === 'group') return groups.find((group) => group.id === item.itemId) || null
  if (item.itemType === 'bookmark') return bookmarks.find((bookmark) => bookmark.id === item.itemId) || null
  for (const group of groups) {
    const sub = group.children.find((candidate) => candidate.id === item.itemId)
    if (sub) return sub
  }
  return null
}

const collectItemShareIds = (groups: Group[], item: RemoteSyncItem): Set<string> => {
  const result = new Set<string>()

  if (item.itemType === 'group') {
    addShareIds(result, groups.find((group) => group.id === item.itemId) as SharedGroup | undefined)
    if (item.content && typeof item.content === 'object') {
      addShareIds(result, item.content as SharedGroup)
    }
    return result
  }

  if (item.itemType === 'subGroup') {
    groups.forEach((rawGroup) => {
      const group = rawGroup as SharedGroup
      const sub = group.children.find((child) => child.id === item.itemId) as SharedSubGroup | undefined
      if (!sub) return
      addShareIds(result, group)
      addShareIds(result, sub)
    })
    if (item.content && typeof item.content === 'object') {
      const sub = item.content as SharedSubGroup
      addShareIds(result, sub)
      const parent = groups.find((group) => group.id === sub.parentGroupId) as SharedGroup | undefined
      addShareIds(result, parent)
    }
    return result
  }

  groups.forEach((rawGroup) => {
    const group = rawGroup as SharedGroup
    group.children.forEach((rawSub) => {
      const sub = rawSub as SharedSubGroup
      if (!sub.bookmarkIds.includes(item.itemId)) return
      addShareIds(result, group)
      addShareIds(result, sub)
    })
  })
  if (item.content && typeof item.content === 'object') {
    const bookmark = item.content as Bookmark
    const locations = Array.isArray(bookmark.locations) ? bookmark.locations : []
    locations.forEach((location) => {
      const group = groups.find((candidate) => candidate.id === location.groupId) as SharedGroup | undefined
      const sub = group?.children.find((candidate) => candidate.id === location.subGroupId) as SharedSubGroup | undefined
      addShareIds(result, group)
      addShareIds(result, sub)
    })
  }
  return result
}

/**
 * 远端分享只能改写明确属于该 shareId 的实体。
 * 过滤基于应用变更前的完整分组图，避免先删除父分组后丢失后续 tombstone 的归属证据。
 */
export const filterRemoteChangesForShare = <T extends RemoteSyncItem>(
  groups: Group[],
  items: T[],
  shareId: string,
  bookmarks: Bookmark[] = [],
): T[] => {
  const normalizedShareId = String(shareId || '').trim()
  if (!normalizedShareId) return []
  return items.filter((item) => {
    if (!collectItemShareIds(groups, item).has(normalizedShareId)) return false
    const local = findLocalEntity(groups, bookmarks, item)
    return !local || item.updatedAt > entityTimestamp(local)
  })
}
