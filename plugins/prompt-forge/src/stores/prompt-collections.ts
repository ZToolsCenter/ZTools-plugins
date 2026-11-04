import type { HistoryEntry, PromptItem } from '../types'

export type PromptSpaceTab = 'all' | 'recent' | 'favorite' | 'project' | 'asset' | 'history' | 'trash' | 'stats'
export type PromptSortBy = 'createdAt' | 'updatedAt' | 'title' | 'usageCount'
export type SortDirection = 'desc' | 'asc'

interface SpaceItemsInput {
  tab: PromptSpaceTab
  tag: string
  projectId: string
  sortBy: PromptSortBy
  sortDir: SortDirection
  liveItems: PromptItem[]
  recentItems: PromptItem[]
  favoriteItems: PromptItem[]
  assetItems: PromptItem[]
  trashItems: PromptItem[]
}

export function selectLiveItems(items: PromptItem[]): PromptItem[] {
  return items.filter(item => !item.deleted)
}

export function selectRecentItems(items: PromptItem[]): PromptItem[] {
  return [...items]
    .filter(item => item.lastUsedAt)
    .sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0))
    .slice(0, 20)
}

export function selectSortedHistory(items: HistoryEntry[], direction: SortDirection): HistoryEntry[] {
  const multiplier = direction === 'desc' ? -1 : 1
  return [...items].sort((a, b) => multiplier * (a.usedAt - b.usedAt))
}

export function selectSpaceItems(input: SpaceItemsInput): PromptItem[] {
  let items: PromptItem[]
  switch (input.tab) {
    case 'all': items = input.liveItems; break
    case 'recent': items = input.recentItems; break
    case 'favorite': items = input.favoriteItems; break
    case 'project': items = input.projectId
      ? input.liveItems.filter(item => item.projectId === input.projectId)
      : input.liveItems.filter(item => item.projectId)
      break
    case 'asset': items = input.assetItems; break
    case 'trash': items = input.trashItems; break
    default: items = input.liveItems
  }

  if (input.tag) items = items.filter(item => item.tags.includes(input.tag))

  const multiplier = input.sortDir === 'desc' ? -1 : 1
  return [...items].sort((a, b) => {
    if (input.sortBy === 'title') return multiplier * (a.title || '').localeCompare(b.title || '')
    if (input.sortBy === 'usageCount') return multiplier * ((a.usageCount || 0) - (b.usageCount || 0))
    return multiplier * ((a[input.sortBy] as number || 0) - (b[input.sortBy] as number || 0))
  })
}

export function collectTags(items: PromptItem[]): string[] {
  const tags = new Set<string>()
  for (const item of items) for (const tag of item.tags) tags.add(tag)
  return [...tags].sort()
}
