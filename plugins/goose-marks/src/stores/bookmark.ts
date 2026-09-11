import { create } from 'zustand'
import PinyinMatch from 'pinyin-match'
import type { Bookmark, Group, BookmarkLocation, SubGroup, IconSource } from '@/types/bookmark'
import {
  TRASH_GROUP_ID,
  uid,
  parseUrlParams,
  createBookmarkSeed,
  createDefaultBookmarkSnapshot,
  createSeedGroups,
  patchBookmarksWithBuiltinSeedIcons
} from '@/stores/bookmarkSeed'
import { bulkMatchMissing, ensureIconForBookmark, backfillRemoteIconCache } from '@/services/iconCache'
import { useSync } from '@/hooks/useSync'
import { emitStorageSync, isUToolsDbAvailable } from '@/lib/utoolsDb'
import { loadBookmarkSnapshot, saveBookmarkSnapshot, type BookmarkSnapshot } from '@/lib/stateRepository'
import { useSettingsStore } from '@/stores/settings'

export { TRASH_GROUP_ID, parseUrlParams }

/**
 * 书签 store（Zustand）—— 完整业务版（从旧 Pinia store 等价迁移）
 * --------------------------------------------------------------------------
 * 数据结构：Group(二级分组 children) + Bookmark(locations 多归属) + 回收站(TRASH_GROUP_ID)。
 * 持久化由 utools.db 仓储统一处理，不再依赖 zustand persist。
 */

/**
 * 虚拟视图：列表面板的数据源切换。
 *  - 'all'    全部书签（非回收站全部）
 *  - 'pinned' 置顶（pinned === true）
 *  - 'recent' 最近使用（按 lastUsed 倒序）
 *  - 'group'  跟随当前选中的分组 / 子分组（旧版默认行为）
 * 不参与持久化（partialize 不含 activeView），属于会话级 UI 状态，避免旧数据迁移与 stale 视图。
 */
export type ActiveView = 'all' | 'pinned' | 'recent' | 'group'

export interface BookmarkState {
  groups: Group[]
  bookmarks: Bookmark[]
  search: string
  activeGroupId: string
  activeSubGroupId: string
  activeView: ActiveView
  isReadOnly: boolean
}

type SetDataPayload = Partial<{
  groups: Group[]
  bookmarks: Bookmark[]
  activeGroupId: string
  activeSubGroupId: string
}>

export interface BookmarkActions {
  // 选择 / 搜索 / 虚拟视图
  setSearch: (value: string) => void
  setActiveView: (view: ActiveView) => void
  setActiveGroup: (groupId: string) => void
  setActiveSubGroup: (subGroupId: string) => void
  setReadOnly: (value: boolean) => void
  selectGroup: (groupId: string, subId?: string) => void
  selectSubGroup: (subId: string) => void
  recordBookmarkUse: (id: string) => void
  ensureValidSelection: (preferredGroupId?: string, preferredSubGroupId?: string) => void
  autoCleanTrash: () => void
  migrateFromLegacy: () => void
  patchBookmarksWithBuiltinSeedIcons: () => void

  // 查询（旧版 getter，作为方法暴露便于 .getState() 调用）
  getBookmarkLocations: (id: string) => BookmarkLocation[]
  isBookmarkInTrash: (bookmark: Bookmark) => boolean

  // 分组
  addGroup: (name: string) => Group
  updateGroup: (id: string, name: string) => void
  removeGroup: (id: string) => boolean
  reorderGroups: (newOrder: Group[]) => void
  findGroupByName: (name: string) => Group | null

  // 子分组
  addSubGroup: (name: string, groupId: string) => SubGroup | null
  updateSubGroup: (groupId: string, subId: string, name: string) => void
  removeSubGroup: (groupId: string, subId: string) => boolean
  reorderSubGroups: (groupId: string, newChildren: SubGroup[]) => void
  moveSubToGroup: (sourceGroupId: string, subId: string, targetGroupId: string) => boolean
  promoteSubToGroup: (sourceGroupId: string, subId: string) => Group | null

  // 书签
  addBookmark: (payload: Omit<Bookmark, 'id' | 'createdAt' | 'updatedAt'>, locations: BookmarkLocation[]) => Bookmark
  updateBookmark: (id: string, updater: Partial<Bookmark>) => void
  updateBookmarkLocations: (bookmarkId: string, newLocations: BookmarkLocation[]) => void
  removeBookmark: (id: string) => void
  removeBookmarkFromLocation: (id: string, groupId: string, subGroupId: string) => void
  restoreBookmark: (id: string) => boolean
  restoreBookmarkFromTrash: (id: string) => boolean
  emptyTrash: () => void
  reorderInSub: (groupId: string, subId: string, fromId: string, toId: string) => void
  moveBookmarkToSubGroup: (
    bookmarkId: string,
    fromGroupId: string,
    fromSubId: string,
    toGroupId: string,
    toSubId: string
  ) => boolean
  quickSaveBookmark: (url: string, title?: string, desc?: string) => Bookmark
  getOrCreateQuickCollectGroup: () => { group: Group; subGroup: SubGroup }

  // 图标
  assignIcon: (id: string, icon: IconSource) => void
  refreshSingleIcon: (bookmark: Bookmark) => Promise<void>
  getMissingIconCandidates: (force?: boolean) => Bookmark[]
  countMissingIconCandidates: (force?: boolean) => number
  refreshMissingIcons: (force?: boolean) => Promise<{
    total: number
    matched: number
    remaining: number
    successList: string[]
    failList: { id: string; title: string }[]
  }>
  backfillIconCache: () => Promise<void>

  // 同步调度
  getShareIdsFromLocations: (locations?: BookmarkLocation[]) => string[]
  getShareIdsFromSubGroup: (groupId: string, subId: string) => string[]
  getShareIdsFromGroup: (groupId: string) => string[]
  scheduleBookmarkSync: (
    bookmarkId: string,
    options?: { isDeleted?: boolean; updatedAt?: number; previousShareIds?: string[]; content?: Bookmark | null }
  ) => void
  scheduleGroupSync: (
    groupId: string,
    options?: { isDeleted?: boolean; updatedAt?: number; previousShareIds?: string[]; orderIndex?: number }
  ) => void
  scheduleSubGroupSync: (
    groupId: string,
    subId: string,
    options?: { isDeleted?: boolean; updatedAt?: number; previousShareIds?: string[] }
  ) => void
  syncAllSharedEntities: (updatedAt?: number) => void

  // 快照 / 整体替换
  loadFromSnapshot: (data: { groups: Group[]; bookmarks: Bookmark[] }, readOnly?: boolean) => void
  setData: (state: SetDataPayload) => void
  resetToDefaultBookmarks: () => void
  $patch: (partial: Partial<BookmarkState>) => void
}

export type BookmarkStore = BookmarkState & BookmarkActions

type ShareAwareGroup = Group & { shareId?: string; sourceShareId?: string; orderIndex?: number }
type ShareAwareSubGroup = SubGroup & { shareId?: string; sourceShareId?: string; parentGroupId?: string }

const createInitialState = (): BookmarkState => {
  const { groups, bookmarks } = createBookmarkSeed()
  return {
    groups,
    bookmarks,
    search: '',
    activeGroupId: 'g-nav',
    activeSubGroupId: 'sg-nav-common',
    activeView: 'all',
    isReadOnly: false
  }
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/**
 * 解析书签当前归属位置列表。
 * 旧数据可能缺少 locations 字段（undefined），此时回退到遍历索引计算。
 * 确保后续过滤逻辑不会把「仍有其他归属」的书签误判为无归属进回收站。
 */
const resolveBookmarkLocations = (
  bookmark: Bookmark,
  getByIndex: (id: string) => BookmarkLocation[]
): BookmarkLocation[] => {
  if (Array.isArray(bookmark.locations) && bookmark.locations.length > 0) {
    return clone(bookmark.locations)
  }
  return getByIndex(bookmark.id)
}

const schedulePush = (
  item: Parameters<ReturnType<typeof useSync.getState>['schedulePush']>[0],
  options?: Parameters<ReturnType<typeof useSync.getState>['schedulePush']>[1]
) => {
  try {
    useSync.getState().schedulePush(item, options)
  } catch (error) {
    console.warn('[Bookmark] schedulePush 失败:', error)
  }
}

export const useBookmarkStore = create<BookmarkStore>()((set, get) => {
      // 在工作副本上原地改写后整体提交，等价旧版 Pinia 的可变 state。
      const commit = (groups: Group[], bookmarks: Bookmark[], extra?: Partial<BookmarkState>) =>
        set({ groups: [...groups], bookmarks: [...bookmarks], ...extra })

      return {
        ...createInitialState(),

        setSearch: (value) => set({ search: typeof value === 'string' ? value : '' }),

        // 切换虚拟视图。切到 all/pinned/recent 时仅改 activeView，
        // 不动 activeGroupId/activeSubGroupId —— 分组树仍可正常展示当前选中态。
        setActiveView: (view) => set({ activeView: view }),

        // 选中分组时，列表数据源自动跟随分组（activeView = 'group'），
        // 等价旧版只有分组列表时的默认行为。
        setActiveGroup: (groupId) => {
          const group = get().groups.find((g) => g.id === groupId)
          if (!group) return
          set({ activeGroupId: groupId, activeSubGroupId: group.children[0]?.id ?? '', activeView: 'group' })
        },

        setActiveSubGroup: (subGroupId) => set({ activeSubGroupId: subGroupId, activeView: 'group' }),

        setReadOnly: (value) => set({ isReadOnly: !!value }),

        selectGroup: (groupId, subId) => {
          const group = get().groups.find((g) => g.id === groupId)
          const firstSub = group?.children?.[0]
          set({ activeGroupId: groupId, activeSubGroupId: subId ?? firstSub?.id ?? '', activeView: 'group' })
        },

        selectSubGroup: (subId) => set({ activeSubGroupId: subId, activeView: 'group' }),

        // 记录书签使用：lastUsed = now、visits++。本地排序数据。
        // 不走 scheduleBookmarkSync（避免把高频本地使用记录推送到同步通道）。
        recordBookmarkUse: (id) => {
          const bookmarks = [...get().bookmarks]
          const idx = bookmarks.findIndex((b) => b.id === id)
          if (idx === -1) return
          const prev = bookmarks[idx]
          bookmarks.splice(idx, 1, {
            ...prev,
            lastUsed: Date.now(),
            visits: (prev.visits ?? 0) + 1
          })
          set({ bookmarks })
        },

        ensureValidSelection: (preferredGroupId, preferredSubGroupId) => {
          const { groups, activeGroupId, activeSubGroupId } = get()
          const wantGroupId = preferredGroupId ?? activeGroupId
          const wantSubGroupId = preferredSubGroupId ?? activeSubGroupId
          if (!groups.length) {
            set({ activeGroupId: '', activeSubGroupId: '' })
            return
          }
          const preferredGroup = groups.find((g) => g.id === wantGroupId)
          const fallbackGroup = preferredGroup || groups.find((g) => g.id !== TRASH_GROUP_ID) || groups[0]
          if (!fallbackGroup) {
            set({ activeGroupId: '', activeSubGroupId: '' })
            return
          }
          const preferredSub = fallbackGroup.children.find((c) => c.id === wantSubGroupId)
          const fallbackSub = preferredSub || fallbackGroup.children[0]
          set({ activeGroupId: fallbackGroup.id, activeSubGroupId: fallbackSub?.id ?? '' })
        },

        autoCleanTrash: () => {
          const groups = clone(get().groups)
          const bookmarks = [...get().bookmarks]
          const trashGroup = groups.find((g) => g.id === TRASH_GROUP_ID)
          if (!trashGroup) return

          const now = Date.now()
          const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000

          trashGroup.children.forEach((sub) => {
            const newIds: string[] = []
            sub.bookmarkIds.forEach((bid) => {
              const bookmark = bookmarks.find((b) => b.id === bid)
              if (!bookmark) return
              if (now - bookmark.updatedAt <= THIRTY_DAYS) {
                newIds.push(bid)
              } else {
                const idx = bookmarks.findIndex((b) => b.id === bid)
                if (idx !== -1) bookmarks.splice(idx, 1)
              }
            })
            if (sub.bookmarkIds.length !== newIds.length) {
              sub.bookmarkIds = newIds
              sub.updatedAt = now
              trashGroup.updatedAt = now
            }
          })

          commit(groups, bookmarks)
        },


        patchBookmarksWithBuiltinSeedIcons: () => {
          const { bookmarks, changed } = patchBookmarksWithBuiltinSeedIcons(get().bookmarks)
          if (changed) set({ bookmarks })
        },

        migrateFromLegacy: () => {
          const state = get()
          const legacyGroups = state.groups as unknown as Array<Record<string, any>>
          const firstSub = legacyGroups[0]?.children?.[0]
          const now = Date.now()

          if (!firstSub || !('bookmarks' in firstSub)) {
            const groups = state.groups.map((g) => ({
              ...g,
              createdAt: g.createdAt || now,
              updatedAt: g.updatedAt || now,
              children: g.children.map((sub) => ({
                ...sub,
                createdAt: sub.createdAt || now,
                updatedAt: sub.updatedAt || now
              }))
            }))
            const bookmarks = state.bookmarks.map((b) => ({
              ...b,
              createdAt: b.createdAt || now,
              updatedAt: b.updatedAt || now,
              // 旧数据无 visits 时兜底为 0；lastUsed 保持 undefined（从未使用过）
              visits: b.visits ?? 0
            }))
            set({ groups, bookmarks })
            get().ensureValidSelection()
            return
          }

          const migratedBookmarks: Bookmark[] = []
          const migratedGroups: Group[] = []

          legacyGroups.forEach((g) => {
            const newChildren: SubGroup[] = (g.children as Array<Record<string, any>>).map((sub) => {
              const bookmarkIds: string[] = (sub.bookmarks as Bookmark[]).map((b) => {
                if (!migratedBookmarks.find((mb) => mb.id === b.id)) {
                  migratedBookmarks.push({
                    ...b,
                    createdAt: b.createdAt || now,
                    updatedAt: b.updatedAt || now,
                    visits: b.visits ?? 0
                  })
                }
                return b.id
              })
              return {
                id: sub.id,
                name: sub.name,
                bookmarkIds,
                createdAt: sub.createdAt || now,
                updatedAt: sub.updatedAt || now
              }
            })
            migratedGroups.push({
              id: g.id,
              name: g.name,
              children: newChildren,
              createdAt: g.createdAt || now,
              updatedAt: g.updatedAt || now
            })
          })

          if (!migratedGroups.find((g) => g.id === TRASH_GROUP_ID)) {
            migratedGroups.push({
              id: TRASH_GROUP_ID,
              name: '回收站',
              createdAt: now,
              updatedAt: now,
              children: [{ id: 'sg-trash', name: '已删除', bookmarkIds: [], createdAt: now, updatedAt: now }]
            })
          }

          set({ groups: migratedGroups, bookmarks: migratedBookmarks })
          get().autoCleanTrash()
        },

        getBookmarkLocations: (id) => {
          const result: BookmarkLocation[] = []
          get().groups.forEach((g) => {
            g.children.forEach((sub) => {
              if (sub.bookmarkIds.includes(id)) result.push({ groupId: g.id, subGroupId: sub.id })
            })
          })
          return result
        },

        isBookmarkInTrash: (bookmark) => {
          const inTrashByLocation =
            Array.isArray(bookmark.locations) &&
            bookmark.locations.some((loc) => loc.groupId === TRASH_GROUP_ID || loc.subGroupId === 'sg-trash')
          const trashGroup = get().groups.find((g) => g.id === TRASH_GROUP_ID)
          const inTrashByGroupIndex =
            !!trashGroup && trashGroup.children.some((sub) => sub.bookmarkIds.includes(bookmark.id))
          return !!inTrashByLocation || inTrashByGroupIndex
        },

        // ---- 同步辅助 ----
        getShareIdsFromLocations: (locations = []) => {
          const shareIds = new Set<string>()
          locations.forEach((loc) => {
            const group = get().groups.find((g) => g.id === loc.groupId) as ShareAwareGroup | undefined
            if (!group) return
            if (group.shareId) shareIds.add(group.shareId)
            if (group.sourceShareId) shareIds.add(group.sourceShareId)
            const sub = group.children.find((c) => c.id === loc.subGroupId) as ShareAwareSubGroup | undefined
            if (!sub) return
            if (sub.shareId) shareIds.add(sub.shareId)
            if (sub.sourceShareId) shareIds.add(sub.sourceShareId)
          })
          return Array.from(shareIds)
        },

        getShareIdsFromSubGroup: (groupId, subId) => {
          const group = get().groups.find((g) => g.id === groupId) as ShareAwareGroup | undefined
          if (!group) return []
          const sub = group.children.find((c) => c.id === subId) as ShareAwareSubGroup | undefined
          const shareIds = new Set<string>()
          if (group.shareId) shareIds.add(group.shareId)
          if (group.sourceShareId) shareIds.add(group.sourceShareId)
          if (sub?.shareId) shareIds.add(sub.shareId)
          if (sub?.sourceShareId) shareIds.add(sub.sourceShareId)
          return Array.from(shareIds)
        },

        getShareIdsFromGroup: (groupId) => {
          const group = get().groups.find((g) => g.id === groupId) as ShareAwareGroup | undefined
          if (!group) return []
          const shareIds = new Set<string>()
          if (group.shareId) shareIds.add(group.shareId)
          if (group.sourceShareId) shareIds.add(group.sourceShareId)
          group.children.forEach((child) => {
            const sub = child as ShareAwareSubGroup
            if (sub.shareId) shareIds.add(sub.shareId)
            if (sub.sourceShareId) shareIds.add(sub.sourceShareId)
          })
          return Array.from(shareIds)
        },

        scheduleBookmarkSync: (bookmarkId, options) => {
          const now = options?.updatedAt || Date.now()
          const bookmark = get().bookmarks.find((b) => b.id === bookmarkId)
          const isDeleted = !!options?.isDeleted
          const content = options?.content ?? bookmark ?? null
          if (!isDeleted && !content) return
          schedulePush(
            { itemId: bookmarkId, itemType: 'bookmark', content, isDeleted, updatedAt: now },
            { previousShareIds: options?.previousShareIds }
          )
        },

        scheduleGroupSync: (groupId, options) => {
          const now = options?.updatedAt || Date.now()
          const group = get().groups.find((g) => g.id === groupId)
          if (options?.isDeleted) {
            schedulePush(
              { itemId: groupId, itemType: 'group', content: null, isDeleted: true, updatedAt: now },
              { previousShareIds: options?.previousShareIds }
            )
            return
          }
          if (!group) return
          const content = clone(group) as ShareAwareGroup
          if (typeof options?.orderIndex === 'number') content.orderIndex = options.orderIndex
          schedulePush(
            { itemId: group.id, itemType: 'group', content, isDeleted: false, updatedAt: now },
            { previousShareIds: options?.previousShareIds }
          )
        },

        scheduleSubGroupSync: (groupId, subId, options) => {
          const now = options?.updatedAt || Date.now()
          const group = get().groups.find((g) => g.id === groupId)
          const sub = group?.children.find((c) => c.id === subId)
          if (options?.isDeleted) {
            schedulePush(
              { itemId: subId, itemType: 'subGroup', content: null, isDeleted: true, updatedAt: now },
              { previousShareIds: options?.previousShareIds }
            )
            return
          }
          if (!group || !sub) return
          schedulePush(
            {
              itemId: sub.id,
              itemType: 'subGroup',
              content: { ...clone(sub), parentGroupId: group.id },
              isDeleted: false,
              updatedAt: now
            },
            { previousShareIds: options?.previousShareIds }
          )
        },

        // ---- 分组 ----
        addGroup: (name) => {
          const groups = clone(get().groups)
          const now = Date.now()
          const group: Group = {
            id: uid(),
            name,
            createdAt: now,
            updatedAt: now,
            children: [{ id: uid(), name: '分组一', bookmarkIds: [], createdAt: now, updatedAt: now }]
          }
          groups.push(group)
          commit(groups, get().bookmarks, {
            activeGroupId: group.id,
            activeSubGroupId: group.children[0].id
          })
          get().scheduleGroupSync(group.id, { updatedAt: now, orderIndex: groups.findIndex((g) => g.id === group.id) })
          return group
        },

        updateGroup: (id, name) => {
          const groups = clone(get().groups)
          const group = groups.find((g) => g.id === id)
          if (!group) return
          const now = Date.now()
          group.name = name
          group.updatedAt = now
          commit(groups, get().bookmarks)
          get().scheduleGroupSync(id, { updatedAt: now, orderIndex: groups.findIndex((g) => g.id === id) })
        },

        addSubGroup: (name, groupId) => {
          const groups = clone(get().groups)
          const group = groups.find((g) => g.id === groupId)
          if (!group) return null
          const now = Date.now()
          const sub: SubGroup = { id: uid(), name, bookmarkIds: [], createdAt: now, updatedAt: now }
          group.children.push(sub)
          group.updatedAt = now
          commit(groups, get().bookmarks, { activeSubGroupId: sub.id })
          get().scheduleSubGroupSync(groupId, sub.id, { updatedAt: now })
          get().scheduleGroupSync(groupId, { updatedAt: now, orderIndex: groups.findIndex((g) => g.id === groupId) })
          return sub
        },

        updateSubGroup: (groupId, subId, name) => {
          const groups = clone(get().groups)
          const group = groups.find((g) => g.id === groupId)
          const sub = group?.children.find((c) => c.id === subId)
          if (!group || !sub) return
          const now = Date.now()
          sub.name = name
          sub.updatedAt = now
          group.updatedAt = now
          commit(groups, get().bookmarks)
          get().scheduleSubGroupSync(groupId, subId, { updatedAt: now })
          get().scheduleGroupSync(groupId, { updatedAt: now, orderIndex: groups.findIndex((g) => g.id === groupId) })
        },

        reorderGroups: (newOrder) => {
          const now = Date.now()
          const current = get().groups
          const trash = current.find((g) => g.id === TRASH_GROUP_ID)
          const filtered = clone(newOrder.filter((g) => g.id !== TRASH_GROUP_ID))
          filtered.forEach((group, index) => {
            group.updatedAt = now + index
          })
          const groups = trash ? [...filtered, trash] : filtered
          commit(groups, get().bookmarks)
          filtered.forEach((group, orderIndex) => {
            get().scheduleGroupSync(group.id, { updatedAt: group.updatedAt, orderIndex })
          })
        },

        reorderSubGroups: (groupId, newChildren) => {
          const groups = clone(get().groups)
          const group = groups.find((g) => g.id === groupId)
          if (!group) return
          const now = Date.now()
          const children = clone(newChildren)
          children.forEach((child, index) => {
            child.updatedAt = now + index
          })
          group.children = children
          group.updatedAt = now
          commit(groups, get().bookmarks)
          children.forEach((child) => {
            get().scheduleSubGroupSync(groupId, child.id, { updatedAt: child.updatedAt })
          })
          get().scheduleGroupSync(groupId, { updatedAt: now, orderIndex: groups.findIndex((g) => g.id === groupId) })
        },

        findGroupByName: (name) => get().groups.find((g) => g.name === name && g.id !== TRASH_GROUP_ID) || null,

        removeGroup: (id) => {
          const groups = clone(get().groups)
          const bookmarks = clone(get().bookmarks)
          const idx = groups.findIndex((g) => g.id === id)
          if (idx === -1) return false
          const group = groups[idx]
          const now = Date.now()

          const previousGroupShareIds = get().getShareIdsFromGroup(id)
          const previousSubShareIdsMap = new Map<string, string[]>()
          const touchedBookmarkShareIdsMap = new Map<string, string[]>()

          group.children.forEach((sub) => {
            previousSubShareIdsMap.set(sub.id, get().getShareIdsFromSubGroup(id, sub.id))
            sub.bookmarkIds.forEach((bid) => {
              if (touchedBookmarkShareIdsMap.has(bid)) return
              const bookmark = bookmarks.find((b) => b.id === bid)
              // 空数组也回退索引：locations=[] 时 previousShareIds 不能算成空集
              const previousLocations = bookmark
                ? resolveBookmarkLocations(bookmark, get().getBookmarkLocations)
                : get().getBookmarkLocations(bid)
              touchedBookmarkShareIdsMap.set(bid, get().getShareIdsFromLocations(previousLocations))
            })
          })

          const toTrash: string[] = []
          group.children.forEach((sub) => {
            sub.bookmarkIds.forEach((bid) => {
              const bookmark = bookmarks.find((b) => b.id === bid)
              if (!bookmark) return
              // 用 resolveBookmarkLocations 兜住旧数据 locations 为 undefined 的情况
              const currentLocations = resolveBookmarkLocations(bookmark, get().getBookmarkLocations)
              const oldLocations = currentLocations
              bookmark.locations = currentLocations.filter((loc) => loc.groupId !== id)
              if (bookmark.locations.length === 0) {
                if (oldLocations.length > 0) bookmark.prevLocations = oldLocations
                bookmark.updatedAt = now
                toTrash.push(bid)
              }
            })
          })

          groups.splice(idx, 1)

          let trashGroup = groups.find((g) => g.id === TRASH_GROUP_ID)
          if (!trashGroup) {
            trashGroup = {
              id: TRASH_GROUP_ID,
              name: '回收站',
              createdAt: now,
              updatedAt: now,
              children: [{ id: 'sg-trash', name: '已删除', bookmarkIds: [], createdAt: now, updatedAt: now }]
            }
            groups.push(trashGroup)
          }
          if (trashGroup.children.length === 0) {
            trashGroup.children.push({ id: 'sg-trash', name: '已删除', bookmarkIds: [], createdAt: now, updatedAt: now })
          }
          const trashSub = trashGroup.children[0]

          toTrash.forEach((bid) => {
            if (!trashSub.bookmarkIds.includes(bid)) trashSub.bookmarkIds.push(bid)
            const bookmark = bookmarks.find((b) => b.id === bid)
            if (bookmark) bookmark.locations = [{ groupId: TRASH_GROUP_ID, subGroupId: trashSub.id }]
          })
          if (toTrash.length > 0) {
            trashSub.updatedAt = now
            trashGroup.updatedAt = now
          }

          let nextActiveGroupId = get().activeGroupId
          let nextActiveSubGroupId = get().activeSubGroupId
          if (nextActiveGroupId === id) {
            nextActiveGroupId = groups[0]?.id ?? ''
            nextActiveSubGroupId = groups[0]?.children[0]?.id ?? ''
          }

          commit(groups, bookmarks, { activeGroupId: nextActiveGroupId, activeSubGroupId: nextActiveSubGroupId })

          touchedBookmarkShareIdsMap.forEach((previousShareIds, bookmarkId) => {
            get().scheduleBookmarkSync(bookmarkId, { updatedAt: now, previousShareIds })
          })
          previousSubShareIdsMap.forEach((previousShareIds, subId) => {
            get().scheduleSubGroupSync(id, subId, { isDeleted: true, updatedAt: now, previousShareIds })
          })
          get().scheduleGroupSync(id, { isDeleted: true, updatedAt: now, previousShareIds: previousGroupShareIds })
          groups
            .filter((g) => g.id !== TRASH_GROUP_ID)
            .forEach((existingGroup, orderIndex) => {
              get().scheduleGroupSync(existingGroup.id, { updatedAt: now, orderIndex })
            })

          return true
        },

        removeSubGroup: (groupId, subId) => {
          const groups = clone(get().groups)
          const bookmarks = clone(get().bookmarks)
          const group = groups.find((g) => g.id === groupId)
          if (!group) return false
          const idx = group.children.findIndex((c) => c.id === subId)
          if (idx === -1) return false
          const sub = group.children[idx]
          const now = Date.now()

          const previousSubShareIds = get().getShareIdsFromSubGroup(groupId, subId)
          const touchedBookmarkShareIdsMap = new Map<string, string[]>()
          sub.bookmarkIds.forEach((bid) => {
            const bookmark = bookmarks.find((b) => b.id === bid)
            const previousLocations = bookmark ? resolveBookmarkLocations(bookmark, get().getBookmarkLocations) : get().getBookmarkLocations(bid)
            touchedBookmarkShareIdsMap.set(bid, get().getShareIdsFromLocations(previousLocations))
          })

          const toTrash: string[] = []
          sub.bookmarkIds.forEach((bid) => {
            const bookmark = bookmarks.find((b) => b.id === bid)
            if (!bookmark) return
            // 用 resolveBookmarkLocations 兜住旧数据 locations 为 undefined 的情况
            const currentLocations = resolveBookmarkLocations(bookmark, get().getBookmarkLocations)
            bookmark.locations = currentLocations.filter(
              (loc) => !(loc.groupId === groupId && loc.subGroupId === subId)
            )
            if (bookmark.locations.length === 0) {
              bookmark.updatedAt = now
              toTrash.push(bid)
            }
          })

          group.children.splice(idx, 1)
          group.updatedAt = now

          let trashGroup = groups.find((g) => g.id === TRASH_GROUP_ID)
          if (!trashGroup) {
            trashGroup = {
              id: TRASH_GROUP_ID,
              name: '回收站',
              createdAt: now,
              updatedAt: now,
              children: [{ id: 'sg-trash', name: '已删除', bookmarkIds: [], createdAt: now, updatedAt: now }]
            }
            groups.push(trashGroup)
          }
          if (trashGroup.children.length === 0) {
            trashGroup.children.push({ id: 'sg-trash', name: '已删除', bookmarkIds: [], createdAt: now, updatedAt: now })
          }
          const trashSub = trashGroup.children[0]

          if (toTrash.length > 0) {
            toTrash.forEach((bid) => {
              if (!trashSub.bookmarkIds.includes(bid)) trashSub.bookmarkIds.push(bid)
              const bookmark = bookmarks.find((b) => b.id === bid)
              if (bookmark) bookmark.locations = [{ groupId: TRASH_GROUP_ID, subGroupId: trashSub.id }]
            })
            trashSub.updatedAt = now
            trashGroup.updatedAt = now
          }

          if (group.children.length === 0) {
            group.children.push({ id: uid(), name: '默认', bookmarkIds: [], createdAt: now, updatedAt: now })
            group.updatedAt = now
          }

          let nextActiveSubGroupId = get().activeSubGroupId
          if (nextActiveSubGroupId === subId) nextActiveSubGroupId = group.children[0]?.id ?? ''

          commit(groups, bookmarks, { activeSubGroupId: nextActiveSubGroupId })

          touchedBookmarkShareIdsMap.forEach((previousShareIds, bookmarkId) => {
            get().scheduleBookmarkSync(bookmarkId, { updatedAt: now, previousShareIds })
          })
          get().scheduleSubGroupSync(groupId, subId, { isDeleted: true, updatedAt: now, previousShareIds: previousSubShareIds })
          get().scheduleGroupSync(groupId, { updatedAt: now, orderIndex: groups.findIndex((g) => g.id === groupId) })

          return true
        },

        moveSubToGroup: (sourceGroupId, subId, targetGroupId) => {
          const groups = clone(get().groups)
          const bookmarks = clone(get().bookmarks)
          const sourceGroup = groups.find((g) => g.id === sourceGroupId)
          const targetGroup = groups.find((g) => g.id === targetGroupId)
          if (!sourceGroup || !targetGroup) return false
          const subIdx = sourceGroup.children.findIndex((c) => c.id === subId)
          if (subIdx === -1) return false
          const previousSubShareIds = get().getShareIdsFromSubGroup(sourceGroupId, subId)
          const [sub] = sourceGroup.children.splice(subIdx, 1)
          const now = Date.now()

          const bookmarkPreviousShareIdsMap = new Map<string, string[]>()
          sub.bookmarkIds.forEach((bid) => {
            const bookmark = bookmarks.find((b) => b.id === bid)
            const previousLocations = bookmark ? resolveBookmarkLocations(bookmark, get().getBookmarkLocations) : get().getBookmarkLocations(bid)
            bookmarkPreviousShareIdsMap.set(bid, get().getShareIdsFromLocations(previousLocations))
          })

          targetGroup.children.push(sub)
          sourceGroup.updatedAt = now
          targetGroup.updatedAt = now
          sub.bookmarkIds.forEach((bid) => {
            const bookmark = bookmarks.find((b) => b.id === bid)
            if (bookmark) {
              // 用 resolveBookmarkLocations 取真实位置（兼容旧数据 locations=[]）
              const currentLocations = resolveBookmarkLocations(bookmark, get().getBookmarkLocations)
              bookmark.locations = currentLocations.map((loc) =>
                loc.groupId === sourceGroupId && loc.subGroupId === subId ? { ...loc, groupId: targetGroupId } : loc
              )
              bookmark.updatedAt = now
            }
          })
          if (sourceGroup.children.length === 0) {
            sourceGroup.children.push({ id: uid(), name: '子分组', bookmarkIds: [], createdAt: now, updatedAt: now })
          }

          commit(groups, bookmarks)

          bookmarkPreviousShareIdsMap.forEach((previousShareIds, bookmarkId) => {
            get().scheduleBookmarkSync(bookmarkId, { updatedAt: now, previousShareIds })
          })
          get().scheduleSubGroupSync(targetGroupId, subId, { updatedAt: now, previousShareIds: previousSubShareIds })
          get().scheduleGroupSync(sourceGroupId, { updatedAt: now, orderIndex: groups.findIndex((g) => g.id === sourceGroupId) })
          get().scheduleGroupSync(targetGroupId, { updatedAt: now, orderIndex: groups.findIndex((g) => g.id === targetGroupId) })
          return true
        },

        promoteSubToGroup: (sourceGroupId, subId) => {
          const groups = clone(get().groups)
          const bookmarks = clone(get().bookmarks)
          const sourceGroup = groups.find((g) => g.id === sourceGroupId)
          if (!sourceGroup) return null
          const subIdx = sourceGroup.children.findIndex((c) => c.id === subId)
          if (subIdx === -1) return null
          const previousSubShareIds = get().getShareIdsFromSubGroup(sourceGroupId, subId)
          const [sub] = sourceGroup.children.splice(subIdx, 1)
          const now = Date.now()

          const bookmarkPreviousShareIdsMap = new Map<string, string[]>()
          sub.bookmarkIds.forEach((bid) => {
            const bookmark = bookmarks.find((b) => b.id === bid)
            const previousLocations = bookmark ? resolveBookmarkLocations(bookmark, get().getBookmarkLocations) : get().getBookmarkLocations(bid)
            bookmarkPreviousShareIdsMap.set(bid, get().getShareIdsFromLocations(previousLocations))
          })

          const newGroup: Group = {
            id: uid(),
            name: sub.name,
            createdAt: now,
            updatedAt: now,
            children: [{ id: sub.id, name: '默认', bookmarkIds: sub.bookmarkIds, createdAt: sub.createdAt, updatedAt: now }]
          }
          const trashIdx = groups.findIndex((g) => g.id === TRASH_GROUP_ID)
          if (trashIdx !== -1) groups.splice(trashIdx, 0, newGroup)
          else groups.push(newGroup)
          sourceGroup.updatedAt = now

          sub.bookmarkIds.forEach((bid) => {
            const bookmark = bookmarks.find((b) => b.id === bid)
            if (bookmark) {
              // 用 resolveBookmarkLocations 取真实位置（兼容旧数据 locations=[]）
              const currentLocations = resolveBookmarkLocations(bookmark, get().getBookmarkLocations)
              bookmark.locations = currentLocations.map((loc) =>
                loc.groupId === sourceGroupId && loc.subGroupId === subId ? { groupId: newGroup.id, subGroupId: sub.id } : loc
              )
              bookmark.updatedAt = now
            }
          })
          if (sourceGroup.children.length === 0) {
            sourceGroup.children.push({ id: uid(), name: '子分组', bookmarkIds: [], createdAt: now, updatedAt: now })
          }

          commit(groups, bookmarks, { activeGroupId: newGroup.id, activeSubGroupId: sub.id })

          bookmarkPreviousShareIdsMap.forEach((previousShareIds, bookmarkId) => {
            get().scheduleBookmarkSync(bookmarkId, { updatedAt: now, previousShareIds })
          })
          get().scheduleSubGroupSync(newGroup.id, sub.id, { updatedAt: now, previousShareIds: previousSubShareIds })
          get().scheduleGroupSync(sourceGroupId, { updatedAt: now, orderIndex: groups.findIndex((g) => g.id === sourceGroupId) })
          get().scheduleGroupSync(newGroup.id, { updatedAt: now, orderIndex: groups.findIndex((g) => g.id === newGroup.id) })
          return newGroup
        },

        // ---- 书签 ----
        addBookmark: (payload, locations) => {
          const groups = clone(get().groups)
          const bookmarks = clone(get().bookmarks)
          const now = Date.now()
          const bookmark: Bookmark = { ...payload, id: uid(), locations, createdAt: now, updatedAt: now }
          bookmarks.push(bookmark)

          locations.forEach((loc) => {
            const group = groups.find((g) => g.id === loc.groupId)
            let sub = group?.children.find((c) => c.id === loc.subGroupId)
            if (!sub && group) {
              const created: SubGroup = { id: uid(), name: '子分组', bookmarkIds: [], createdAt: now, updatedAt: now }
              group.children.push(created)
              sub = created
            }
            if (sub && group && !sub.bookmarkIds.includes(bookmark.id)) {
              sub.bookmarkIds.push(bookmark.id)
              sub.updatedAt = now
              group.updatedAt = now
            }
          })

          commit(groups, bookmarks)

          get().scheduleBookmarkSync(bookmark.id, { updatedAt: now })
          const affectedSubKeys = new Set<string>()
          locations.forEach((loc) => affectedSubKeys.add(`${loc.groupId}:${loc.subGroupId}`))
          affectedSubKeys.forEach((key) => {
            const [groupId, subId] = key.split(':')
            if (groupId && subId) get().scheduleSubGroupSync(groupId, subId, { updatedAt: now })
          })
          const affectedGroupIds = new Set<string>()
          locations.forEach((loc) => affectedGroupIds.add(loc.groupId))
          affectedGroupIds.forEach((groupId) => {
            get().scheduleGroupSync(groupId, { updatedAt: now, orderIndex: groups.findIndex((g) => g.id === groupId) })
          })
          return bookmark
        },

        updateBookmark: (id, updater) => {
          const bookmarks = clone(get().bookmarks)
          const idx = bookmarks.findIndex((b) => b.id === id)
          if (idx === -1) return
          const bookmark = bookmarks[idx]
          const now = Date.now()
          const originalUrl = bookmark.url
          const originalIcon = bookmark.icon
          Object.assign(bookmark, updater, { updatedAt: now })
          commit(get().groups, bookmarks)

          if (updater.url && updater.url !== originalUrl && (!originalIcon || originalIcon.type === 'text')) {
            void get().refreshSingleIcon(bookmark)
          }
          get().scheduleBookmarkSync(bookmark.id, { updatedAt: now })
        },

        updateBookmarkLocations: (bookmarkId, newLocations) => {
          const groups = clone(get().groups)
          const bookmarks = clone(get().bookmarks)
          const now = Date.now()
          const bookmark = bookmarks.find((b) => b.id === bookmarkId)
          const previousLocations = bookmark ? resolveBookmarkLocations(bookmark, get().getBookmarkLocations) : get().getBookmarkLocations(bookmarkId)
          const previousShareIds = get().getShareIdsFromLocations(previousLocations)
          const newLocSet = new Set(newLocations.map((loc) => `${loc.groupId}:${loc.subGroupId}`))

          groups.forEach((g) => {
            let groupChanged = false
            g.children.forEach((sub) => {
              const key = `${g.id}:${sub.id}`
              if (!newLocSet.has(key)) {
                const originalLen = sub.bookmarkIds.length
                sub.bookmarkIds = sub.bookmarkIds.filter((id) => id !== bookmarkId)
                if (sub.bookmarkIds.length !== originalLen) {
                  sub.updatedAt = now
                  groupChanged = true
                }
              }
            })
            if (groupChanged) g.updatedAt = now
          })

          newLocations.forEach((loc) => {
            const group = groups.find((g) => g.id === loc.groupId)
            const sub = group?.children.find((c) => c.id === loc.subGroupId)
            if (!sub || !group) return
            if (!sub.bookmarkIds.includes(bookmarkId)) {
              sub.bookmarkIds.push(bookmarkId)
              sub.updatedAt = now
              group.updatedAt = now
            }
          })

          if (bookmark) {
            bookmark.locations = newLocations
            bookmark.updatedAt = now
          }

          commit(groups, bookmarks)

          const affectedSubKeys = new Set<string>()
          previousLocations.forEach((loc) => affectedSubKeys.add(`${loc.groupId}:${loc.subGroupId}`))
          newLocations.forEach((loc) => affectedSubKeys.add(`${loc.groupId}:${loc.subGroupId}`))
          affectedSubKeys.forEach((key) => {
            const [groupId, subId] = key.split(':')
            if (groupId && subId) get().scheduleSubGroupSync(groupId, subId, { updatedAt: now })
          })
          const affectedGroupIds = new Set<string>()
          previousLocations.forEach((loc) => affectedGroupIds.add(loc.groupId))
          newLocations.forEach((loc) => affectedGroupIds.add(loc.groupId))
          affectedGroupIds.forEach((groupId) => {
            get().scheduleGroupSync(groupId, { updatedAt: now, orderIndex: groups.findIndex((g) => g.id === groupId) })
          })
          get().scheduleBookmarkSync(bookmarkId, { updatedAt: now, previousShareIds })
        },

        removeBookmark: (id) => {
          const now = Date.now()
          const locations = get().getBookmarkLocations(id)
          const inTrash = locations.some((loc) => loc.groupId === TRASH_GROUP_ID)

          if (inTrash) {
            const groups = clone(get().groups)
            let bookmarks = clone(get().bookmarks)
            const bookmark = bookmarks.find((b) => b.id === id)
            const previousLocations = bookmark && Array.isArray(bookmark.locations) && bookmark.locations.length > 0 ? clone(bookmark.locations) : locations
            const previousShareIds = get().getShareIdsFromLocations(previousLocations)

            groups.forEach((g) => {
              let groupChanged = false
              g.children.forEach((sub) => {
                const originalLen = sub.bookmarkIds.length
                sub.bookmarkIds = sub.bookmarkIds.filter((bid) => bid !== id)
                if (sub.bookmarkIds.length !== originalLen) {
                  sub.updatedAt = now
                  groupChanged = true
                }
              })
              if (groupChanged) g.updatedAt = now
            })
            bookmarks = bookmarks.filter((b) => b.id !== id)
            commit(groups, bookmarks)
            get().scheduleBookmarkSync(id, { isDeleted: true, updatedAt: now, previousShareIds, content: null })
          } else {
            const bookmarks = clone(get().bookmarks)
            const bookmark = bookmarks.find((b) => b.id === id)
            if (bookmark) {
              bookmark.updatedAt = now
              if (bookmark.locations && bookmark.locations.length > 0) {
                bookmark.prevLocations = clone(bookmark.locations)
              }
              commit(get().groups, bookmarks)
              get().updateBookmarkLocations(id, [{ groupId: TRASH_GROUP_ID, subGroupId: 'sg-trash' }])
            }
          }
        },

        removeBookmarkFromLocation: (id, groupId, subGroupId) => {
          const locations = get().getBookmarkLocations(id)
          const remainingLocations = locations.filter(
            (loc) => !(loc.groupId === groupId && loc.subGroupId === subGroupId)
          )
          if (remainingLocations.length > 0) {
            get().updateBookmarkLocations(id, remainingLocations)
          } else {
            get().removeBookmark(id)
          }
        },

        restoreBookmark: (id) => get().restoreBookmarkFromTrash(id),

        restoreBookmarkFromTrash: (id) => {
          const groups = clone(get().groups)
          const bookmarks = clone(get().bookmarks)
          const bookmark = bookmarks.find((b) => b.id === id)
          if (!bookmark) return false
          const now = Date.now()
          const trashGroup = groups.find((g) => g.id === TRASH_GROUP_ID)
          const trashSubs = trashGroup?.children ?? []
          const previousLocations = resolveBookmarkLocations(bookmark, get().getBookmarkLocations)
          const previousShareIds = get().getShareIdsFromLocations(previousLocations)

          let targetLocations: BookmarkLocation[] = []
          if (bookmark.prevLocations && bookmark.prevLocations.length > 0) {
            targetLocations = bookmark.prevLocations.filter((loc) => {
              const group = groups.find((g) => g.id === loc.groupId)
              return group && group.id !== TRASH_GROUP_ID && group.children.some((c) => c.id === loc.subGroupId)
            })
          }
          if (targetLocations.length === 0) {
            const defaultGroup = groups.find((g) => g.id !== TRASH_GROUP_ID)
            if (defaultGroup && defaultGroup.children.length > 0) {
              targetLocations = [{ groupId: defaultGroup.id, subGroupId: defaultGroup.children[0].id }]
            } else {
              const createdGroups = createSeedGroups()
              const seedGroup = createdGroups.find((g) => g.id !== TRASH_GROUP_ID)!
              groups.unshift(seedGroup)
              targetLocations = [{ groupId: seedGroup.id, subGroupId: seedGroup.children[0].id }]
            }
          }

          trashSubs.forEach((sub) => {
            sub.bookmarkIds = sub.bookmarkIds.filter((bid) => bid !== id)
            sub.updatedAt = now
          })
          if (trashGroup) trashGroup.updatedAt = now

          bookmark.isDeleted = false
          bookmark.updatedAt = now
          delete bookmark.prevLocations

          // 先提交移出回收站的中间态，再用 updateBookmarkLocations 落定目标位置
          commit(groups, bookmarks)
          get().updateBookmarkLocations(id, targetLocations)
          get().selectGroup(targetLocations[0].groupId, targetLocations[0].subGroupId)
          get().scheduleBookmarkSync(id, { updatedAt: now, previousShareIds })
          targetLocations.forEach((loc) => {
            get().scheduleSubGroupSync(loc.groupId, loc.subGroupId, { updatedAt: now })
            get().scheduleGroupSync(loc.groupId, {
              updatedAt: now,
              orderIndex: get().groups.findIndex((g) => g.id === loc.groupId)
            })
          })
          return true
        },

        emptyTrash: () => {
          const groups = clone(get().groups)
          let bookmarks = clone(get().bookmarks)
          const trashGroup = groups.find((g) => g.id === TRASH_GROUP_ID)
          const trashSub = trashGroup?.children[0]
          if (!trashSub || !trashGroup) return
          const now = Date.now()
          const idsToRemove = [...trashSub.bookmarkIds]
          const previousShareIdsMap = new Map<string, string[]>()
          idsToRemove.forEach((id) => {
            const bookmark = bookmarks.find((b) => b.id === id)
            const previousLocations = bookmark ? resolveBookmarkLocations(bookmark, get().getBookmarkLocations) : get().getBookmarkLocations(id)
            previousShareIdsMap.set(id, get().getShareIdsFromLocations(previousLocations))
          })
          idsToRemove.forEach((id) => {
            trashSub.bookmarkIds = trashSub.bookmarkIds.filter((bid) => bid !== id)
            bookmarks = bookmarks.filter((b) => b.id !== id)
          })
          trashSub.updatedAt = now
          trashGroup.updatedAt = now
          commit(groups, bookmarks)
          idsToRemove.forEach((id) => {
            get().scheduleBookmarkSync(id, {
              isDeleted: true,
              updatedAt: now,
              previousShareIds: previousShareIdsMap.get(id) || [],
              content: null
            })
          })
        },

        reorderInSub: (groupId, subId, fromId, toId) => {
          const groups = clone(get().groups)
          const group = groups.find((g) => g.id === groupId)
          const sub = group?.children.find((c) => c.id === subId)
          if (!sub || !group) return
          const fromIdx = sub.bookmarkIds.indexOf(fromId)
          const toIdx = sub.bookmarkIds.indexOf(toId)
          if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return
          const list = [...sub.bookmarkIds]
          const [moved] = list.splice(fromIdx, 1)
          list.splice(toIdx, 0, moved)
          sub.bookmarkIds = list
          const now = Date.now()
          sub.updatedAt = now
          group.updatedAt = now
          commit(groups, get().bookmarks)
          get().scheduleSubGroupSync(groupId, subId, { updatedAt: now })
          get().scheduleGroupSync(groupId, { updatedAt: now, orderIndex: groups.findIndex((g) => g.id === groupId) })
        },

        moveBookmarkToSubGroup: (bookmarkId, fromGroupId, fromSubId, toGroupId, toSubId) => {
          if (fromGroupId === toGroupId && fromSubId === toSubId) return false
          const groups = clone(get().groups)
          const bookmarks = clone(get().bookmarks)
          const fromGroup = groups.find((g) => g.id === fromGroupId)
          const fromSub = fromGroup?.children.find((c) => c.id === fromSubId)
          const toGroup = groups.find((g) => g.id === toGroupId)
          const toSub = toGroup?.children.find((c) => c.id === toSubId)
          if (!fromSub || !toSub || !fromGroup || !toGroup) return false
          if (!fromSub.bookmarkIds.includes(bookmarkId)) return false
          const bookmark = bookmarks.find((b) => b.id === bookmarkId)
          const previousLocations = bookmark ? resolveBookmarkLocations(bookmark, get().getBookmarkLocations) : get().getBookmarkLocations(bookmarkId)
          const previousShareIds = get().getShareIdsFromLocations(previousLocations)
          const now = Date.now()
          fromSub.bookmarkIds = fromSub.bookmarkIds.filter((id) => id !== bookmarkId)
          fromSub.updatedAt = now
          fromGroup.updatedAt = now
          if (!toSub.bookmarkIds.includes(bookmarkId)) {
            toSub.bookmarkIds.push(bookmarkId)
            toSub.updatedAt = now
            toGroup.updatedAt = now
          }
          if (bookmark) {
            // 用 resolveBookmarkLocations 取真实位置（兼容旧数据 locations=[]）
            const currentLocations = resolveBookmarkLocations(bookmark, get().getBookmarkLocations)
            const filtered = currentLocations.filter(
              (loc) => !(loc.groupId === fromGroupId && loc.subGroupId === fromSubId)
            )
            if (!filtered.some((loc) => loc.groupId === toGroupId && loc.subGroupId === toSubId)) {
              filtered.push({ groupId: toGroupId, subGroupId: toSubId })
            }
            bookmark.locations = filtered
            bookmark.updatedAt = now
          }
          commit(groups, bookmarks)
          if (bookmark) get().scheduleBookmarkSync(bookmarkId, { updatedAt: now, previousShareIds })
          get().scheduleSubGroupSync(fromGroupId, fromSubId, { updatedAt: now })
          get().scheduleSubGroupSync(toGroupId, toSubId, { updatedAt: now })
          get().scheduleGroupSync(fromGroupId, { updatedAt: now, orderIndex: groups.findIndex((g) => g.id === fromGroupId) })
          if (fromGroupId !== toGroupId) {
            get().scheduleGroupSync(toGroupId, { updatedAt: now, orderIndex: groups.findIndex((g) => g.id === toGroupId) })
          }
          return true
        },

        getOrCreateQuickCollectGroup: () => {
          const QUICK_COLLECT_NAME = '快速收集'
          const existing = get().findGroupByName(QUICK_COLLECT_NAME)
          if (existing && existing.children.length > 0) {
            return { group: existing, subGroup: existing.children[0] }
          }
          const groups = clone(get().groups)
          const now = Date.now()
          let group = groups.find((g) => g.name === QUICK_COLLECT_NAME && g.id !== TRASH_GROUP_ID)
          if (!group) {
            const newGroup: Group = {
              id: uid(),
              name: QUICK_COLLECT_NAME,
              createdAt: now,
              updatedAt: now,
              children: [{ id: uid(), name: '收集', bookmarkIds: [], createdAt: now, updatedAt: now }]
            }
            const trashIdx = groups.findIndex((g) => g.id === TRASH_GROUP_ID)
            if (trashIdx !== -1) groups.splice(trashIdx, 0, newGroup)
            else groups.push(newGroup)
            group = newGroup
          }
          if (!group.children || group.children.length === 0) {
            group.children = [{ id: uid(), name: '收集', bookmarkIds: [], createdAt: now, updatedAt: now }]
            group.updatedAt = now
          }
          commit(groups, get().bookmarks)
          return { group, subGroup: group.children[0] }
        },

        quickSaveBookmark: (url, title, desc) => {
          const { group, subGroup } = get().getOrCreateQuickCollectGroup()
          const now = Date.now()
          const groups = clone(get().groups)
          const bookmarks = clone(get().bookmarks)
          const liveGroup = groups.find((g) => g.id === group.id)
          const liveSub = liveGroup?.children.find((c) => c.id === subGroup.id)
          if (!liveGroup || !liveSub) {
            console.warn('[quickSaveBookmark] 快速收集分组未找到，尝试重新创建')
            const { group: retryGroup, subGroup: retrySub } = get().getOrCreateQuickCollectGroup()
            const retryLiveGroup = get().groups.find((g) => g.id === retryGroup.id)
            const retryLiveSub = retryLiveGroup?.children.find((c) => c.id === retrySub.id)
            if (!retryLiveGroup || !retryLiveSub) {
              console.warn('[quickSaveBookmark] 快速收集分组创建失败，放弃保存')
              const fallback: Bookmark = {
                id: uid(),
                title: title || url,
                url,
                desc: desc || '',
                tags: [],
                locations: [],
                createdAt: now,
                updatedAt: now
              }
              return fallback
            }
            return get().quickSaveBookmark(url, title, desc)
          }

          const existingBookmark = bookmarks.find((b) => b.url === url && !b.isDeleted)
          if (existingBookmark) {
            const alreadyInQuickCollect = liveSub.bookmarkIds.includes(existingBookmark.id)
            if (!alreadyInQuickCollect) {
              // 用 resolveBookmarkLocations 取真实位置（兼容旧数据 locations=[]）
              const previousLocations = resolveBookmarkLocations(existingBookmark, get().getBookmarkLocations)
              const previousShareIds = get().getShareIdsFromLocations(previousLocations)
              liveSub.bookmarkIds.unshift(existingBookmark.id)
              liveSub.updatedAt = now
              liveGroup.updatedAt = now
              // 基于真实位置合并新位置，确保原有索引归属不丢失
              existingBookmark.locations = [...previousLocations, { groupId: liveGroup.id, subGroupId: liveSub.id }]
              existingBookmark.updatedAt = now
              commit(groups, bookmarks)
              get().scheduleBookmarkSync(existingBookmark.id, { updatedAt: now, previousShareIds })
              get().scheduleSubGroupSync(liveGroup.id, liveSub.id, { updatedAt: now })
              get().scheduleGroupSync(liveGroup.id, { updatedAt: now, orderIndex: groups.findIndex((g) => g.id === liveGroup.id) })
            }
            return existingBookmark
          }

          const bookmark: Bookmark = {
            id: uid(),
            // 标题留空（而非塞 URL）：列表/卡片本就 `title || url` 兜底显示，
            // 留空才能让后台元信息水合（enqueueMetadataHydration 的 shouldHydrateTitle 守卫）放行补全真实标题
            title: title || '',
            url,
            desc: desc || '',
            tags: [],
            locations: [{ groupId: liveGroup.id, subGroupId: liveSub.id }],
            createdAt: now,
            updatedAt: now
          }
          bookmarks.push(bookmark)
          liveSub.bookmarkIds.unshift(bookmark.id)
          liveSub.updatedAt = now
          liveGroup.updatedAt = now
          commit(groups, bookmarks)

          void ensureIconForBookmark(bookmark).then((icon) => {
            if (icon) get().assignIcon(bookmark.id, icon)
          })

          get().scheduleBookmarkSync(bookmark.id, { updatedAt: now })
          get().scheduleSubGroupSync(liveGroup.id, liveSub.id, { updatedAt: now })
          get().scheduleGroupSync(liveGroup.id, { updatedAt: now, orderIndex: groups.findIndex((g) => g.id === liveGroup.id) })
          return bookmark
        },

        // ---- 图标 ----
        assignIcon: (id, icon) => {
          const bookmarks = [...get().bookmarks]
          const idx = bookmarks.findIndex((b) => b.id === id)
          if (idx === -1) return
          const prev = bookmarks[idx]
          bookmarks.splice(idx, 1, {
            ...prev,
            icon,
            iconMatchedAt: Date.now(),
            iconMatchFailedAt: undefined,
            iconMatchFailedReason: undefined,
            updatedAt: Date.now()
          })
          set({ bookmarks })
        },

        refreshSingleIcon: async (bookmark) => {
          const icon = await ensureIconForBookmark(bookmark)
          if (!icon) return
          get().assignIcon(bookmark.id, icon)
        },

        getMissingIconCandidates: (force = false) => {
          const settingsStore = useSettingsStore.getState()
          return get().bookmarks.filter((bookmark) => {
            if (get().isBookmarkInTrash(bookmark)) return false
            if (settingsStore.skipFailedIconMatch && bookmark.iconMatchFailedAt && !force) return false
            return !bookmark.icon || bookmark.icon.type === 'text'
          })
        },

        countMissingIconCandidates: (force = false) => get().getMissingIconCandidates(force).length,

        refreshMissingIcons: async (force = false) => {
          const missing = get().getMissingIconCandidates(force)
          const result = await bulkMatchMissing(missing)

          const successList: string[] = []
          const failList: { id: string; title: string }[] = []
          const now = Date.now()

          const bookmarks = clone(get().bookmarks)
          missing.forEach((bookmark) => {
            const live = bookmarks.find((b) => b.id === bookmark.id)
            if (result.has(bookmark.id)) {
              successList.push(bookmark.title || bookmark.url)
              if (live) {
                live.icon = result.get(bookmark.id)
                live.iconMatchedAt = now
                live.iconMatchFailedAt = undefined
                live.iconMatchFailedReason = undefined
                live.updatedAt = now
              }
            } else {
              failList.push({ id: bookmark.id, title: bookmark.title || bookmark.url })
              if (live) {
                live.iconMatchFailedAt = now
                live.iconMatchFailedReason = 'no_icon'
              }
            }
          })
          set({ bookmarks })

          return {
            total: missing.length,
            matched: result.size,
            remaining: get().countMissingIconCandidates(force),
            successList,
            failList
          }
        },

        // 把远程图标回填为本地 base64：纯本地缓存优化，成功一次后渲染不再联网。
        // 刻意不改 updatedAt、不调度同步，避免把 base64 推到云端污染同步数据。
        backfillIconCache: async () => {
          const result = await backfillRemoteIconCache(get().bookmarks)
          if (result.size === 0) return
          const bookmarks = [...get().bookmarks]
          let changed = false
          result.forEach((cache, id) => {
            const idx = bookmarks.findIndex((b) => b.id === id)
            if (idx === -1) return
            const prev = bookmarks[idx]
            if (prev.icon?.type !== 'remote') return
            bookmarks.splice(idx, 1, {
              ...prev,
              icon: { ...prev.icon, cache, fetchedAt: Date.now() }
            })
            changed = true
          })
          if (changed) set({ bookmarks })
        },

        syncAllSharedEntities: (updatedAt = Date.now()) => {
          get()
            .groups.filter((group) => group.id !== TRASH_GROUP_ID)
            .forEach((group, orderIndex) => {
              get().scheduleGroupSync(group.id, { updatedAt, orderIndex })
            })
          get().groups.forEach((group) => {
            group.children.forEach((sub) => {
              get().scheduleSubGroupSync(group.id, sub.id, { updatedAt })
            })
          })
          get().bookmarks.forEach((bookmark) => {
            get().scheduleBookmarkSync(bookmark.id, { updatedAt })
          })
        },

        // ---- 快照 / 整体替换 ----
        loadFromSnapshot: (data, readOnly = false) => {
          const preferredGroupId = get().activeGroupId
          const preferredSubGroupId = get().activeSubGroupId
          const bookmarks = patchBookmarksWithBuiltinSeedIcons(data.bookmarks).bookmarks
          set({ groups: data.groups, bookmarks, isReadOnly: readOnly })
          get().ensureValidSelection(preferredGroupId, preferredSubGroupId)
        },

        setData: (state) => {
          const next = { ...state }
          if (state.bookmarks) {
            next.bookmarks = patchBookmarksWithBuiltinSeedIcons(state.bookmarks).bookmarks
          }
          set(next)
        },

        resetToDefaultBookmarks: () => {
          const snap = createDefaultBookmarkSnapshot()
          get().loadFromSnapshot(snap, false)
          set({
            search: '',
            activeView: 'all',
            activeGroupId: 'g-nav',
            activeSubGroupId: 'sg-nav-common',
            isReadOnly: false
          })
        },

        $patch: (partial) => set(partial)
      }
    })

const UTOOLS_PLUGIN_OUT_EVENT = 'goose-marks:plugin-out'
const BOOKMARK_PERSIST_DEBOUNCE_MS = 120

interface BookmarkPersistJob {
  snapshot: BookmarkSnapshot
  serialized: string
}

const pickBookmarkSnapshot = (state: BookmarkStore): BookmarkSnapshot => ({
  groups: clone(state.groups),
  bookmarks: clone(state.bookmarks),
  activeGroupId: state.activeGroupId,
  activeSubGroupId: state.activeSubGroupId
})

let bookmarkPersistenceStarted = false
let bookmarkPersistPromise: Promise<void> | null = null
let pendingBookmarkPersistJob: BookmarkPersistJob | null = null
let lastPersistedBookmarkState = ''
let bookmarkPersistenceFlushEventsStarted = false
let bookmarkPersistTimer: ReturnType<typeof setTimeout> | null = null
let lastQueuedGroups: Group[] | null = null
let lastQueuedBookmarks: Bookmark[] | null = null
let lastQueuedActiveGroupId = ''
let lastQueuedActiveSubGroupId = ''

const queueBookmarkPersistJob = (state: BookmarkStore, force = false): boolean => {
  if (!isUToolsDbAvailable()) return false
  if (
    !force &&
    state.groups === lastQueuedGroups &&
    state.bookmarks === lastQueuedBookmarks &&
    state.activeGroupId === lastQueuedActiveGroupId &&
    state.activeSubGroupId === lastQueuedActiveSubGroupId
  ) {
    return false
  }
  lastQueuedGroups = state.groups
  lastQueuedBookmarks = state.bookmarks
  lastQueuedActiveGroupId = state.activeGroupId
  lastQueuedActiveSubGroupId = state.activeSubGroupId
  const snapshot = pickBookmarkSnapshot(state)
  const serialized = JSON.stringify(snapshot)
  if (serialized === lastPersistedBookmarkState && !pendingBookmarkPersistJob) return false
  pendingBookmarkPersistJob = { snapshot, serialized }
  return true
}

const drainBookmarkPersistQueue = (): Promise<void> => {
  if (bookmarkPersistPromise) return bookmarkPersistPromise

  bookmarkPersistPromise = (async () => {
    while (pendingBookmarkPersistJob) {
      const job = pendingBookmarkPersistJob
      pendingBookmarkPersistJob = null
      if (job.serialized === lastPersistedBookmarkState) continue

      const written = await saveBookmarkSnapshot(job.snapshot)
      lastPersistedBookmarkState = job.serialized
      if (written.dataChanged) emitStorageSync('bookmark', written.serialized)
    }
  })()
    .catch((error) => {
      console.error('[bookmark] 保存失败:', error)
    })
    .finally(() => {
      bookmarkPersistPromise = null
      if (pendingBookmarkPersistJob && pendingBookmarkPersistJob.serialized !== lastPersistedBookmarkState) {
        void drainBookmarkPersistQueue()
      }
    })

  return bookmarkPersistPromise
}

const enqueueBookmarkPersist = (state: BookmarkStore): void => {
  if (!queueBookmarkPersistJob(state)) return
  if (bookmarkPersistTimer) clearTimeout(bookmarkPersistTimer)
  bookmarkPersistTimer = setTimeout(() => {
    bookmarkPersistTimer = null
    void drainBookmarkPersistQueue()
  }, BOOKMARK_PERSIST_DEBOUNCE_MS)
}

export const flushBookmarkStorePersistence = async (): Promise<void> => {
  if (bookmarkPersistTimer) {
    clearTimeout(bookmarkPersistTimer)
    bookmarkPersistTimer = null
  }
  queueBookmarkPersistJob(useBookmarkStore.getState(), true)
  await drainBookmarkPersistQueue()
}

const bindBookmarkPersistenceFlushEvents = (): void => {
  if (bookmarkPersistenceFlushEventsStarted || typeof window === 'undefined') return
  bookmarkPersistenceFlushEventsStarted = true

  const flush = () => {
    void flushBookmarkStorePersistence()
  }
  const flushWhenHidden = () => {
    if (document.visibilityState === 'hidden') flush()
  }

  window.addEventListener(UTOOLS_PLUGIN_OUT_EVENT, flush)
  window.addEventListener('pagehide', flush)
  window.addEventListener('beforeunload', flush)
  document.addEventListener('visibilitychange', flushWhenHidden)
}

export const initializeBookmarkStorePersistence = async (): Promise<void> => {
  if (bookmarkPersistenceStarted) return
  bookmarkPersistenceStarted = true

  const persisted = await loadBookmarkSnapshot()
  if (persisted) {
    const patched = patchBookmarksWithBuiltinSeedIcons(persisted.bookmarks).bookmarks
    useBookmarkStore.setState({
      groups: persisted.groups,
      bookmarks: patched,
      activeGroupId: persisted.activeGroupId,
      activeSubGroupId: persisted.activeSubGroupId
    })
  }

  useBookmarkStore.getState().migrateFromLegacy()
  useBookmarkStore.getState().patchBookmarksWithBuiltinSeedIcons()
  useBookmarkStore.getState().ensureValidSelection()

  if (!isUToolsDbAvailable()) return

  useBookmarkStore.subscribe((state) => {
    enqueueBookmarkPersist(state)
  })
  bindBookmarkPersistenceFlushEvents()
  lastPersistedBookmarkState = ''
  enqueueBookmarkPersist(useBookmarkStore.getState())

  void useBookmarkStore.getState().backfillIconCache()
  void useBookmarkStore.getState().refreshMissingIcons()
}

// ---- 查询选择器（等价旧版 getters，供组件以 useBookmarkStore(selector) 使用）----

export const selectCurrentGroup = (s: BookmarkStore): Group | undefined =>
  s.groups.find((g) => g.id === s.activeGroupId)

export const selectCurrentSubGroup = (s: BookmarkStore): { group?: Group; sub?: SubGroup } => {
  const group = s.groups.find((g) => g.id === s.activeGroupId)
  const sub = group?.children.find((c) => c.id === s.activeSubGroupId)
  return { group, sub }
}

export const selectCurrentBookmarks = (s: BookmarkStore): Bookmark[] => {
  const { sub } = selectCurrentSubGroup(s)
  if (!sub) return []
  return sub.bookmarkIds
    .map((id) => s.bookmarks.find((b) => b.id === id))
    .filter((b): b is Bookmark => !!b && !b.isDeleted)
}

export const selectFilteredBookmarks = (s: BookmarkStore): Bookmark[] => {
  const query = (typeof s.search === 'string' ? s.search : '').trim().toLowerCase()
  const pool: Bookmark[] = []

  if (s.activeGroupId === TRASH_GROUP_ID) {
    const trashGroup = s.groups.find((g) => g.id === TRASH_GROUP_ID)
    trashGroup?.children.forEach((sub) => {
      sub.bookmarkIds.forEach((id) => {
        const bm = s.bookmarks.find((b) => b.id === id)
        if (bm && !bm.isDeleted) pool.push(bm)
      })
    })
  } else {
    s.groups.forEach((group) => {
      if (group.id === TRASH_GROUP_ID) return
      group.children.forEach((sub) => {
        sub.bookmarkIds.forEach((id) => {
          const bm = s.bookmarks.find((b) => b.id === id)
          if (bm && !bm.isDeleted) pool.push(bm)
        })
      })
    })
  }

  if (!query) return pool
  return pool.filter((item) => {
    const haystack = [item.title, item.desc ?? '', item.url, (item.tags ?? []).join(' ')].join(' ').toLowerCase()
    if (haystack.includes(query)) return true
    return !!PinyinMatch.match(haystack, query)
  })
}

/**
 * 非回收站全部书签（去重）。
 * 以分组树为准遍历：只有挂在非回收站子分组里的书签才算「有效」，
 * 与 selectFilteredBookmarks 的池子口径一致。
 */
const collectNonTrashBookmarks = (s: BookmarkStore): Bookmark[] => {
  const seen = new Set<string>()
  const result: Bookmark[] = []
  s.groups.forEach((group) => {
    if (group.id === TRASH_GROUP_ID) return
    group.children.forEach((sub) => {
      sub.bookmarkIds.forEach((id) => {
        if (seen.has(id)) return
        const bm = s.bookmarks.find((b) => b.id === id)
        if (bm && !bm.isDeleted) {
          seen.add(id)
          result.push(bm)
        }
      })
    })
  })
  return result
}

// 全部书签视图：非回收站全部（返回数组，供 useShallow 消费）
export const selectAllBookmarks = (s: BookmarkStore): Bookmark[] => collectNonTrashBookmarks(s)

// 置顶视图：pinned === true（仍限定在非回收站范围内）
export const selectPinnedBookmarks = (s: BookmarkStore): Bookmark[] =>
  collectNonTrashBookmarks(s).filter((b) => b.pinned === true)

// 最近使用视图：按 lastUsed 倒序，无 lastUsed 的排到末尾（保持原相对顺序）
export const selectRecentBookmarks = (s: BookmarkStore): Bookmark[] => {
  const list = collectNonTrashBookmarks(s)
  return [...list].sort((a, b) => {
    const la = a.lastUsed ?? 0
    const lb = b.lastUsed ?? 0
    if (la === lb) return 0
    return lb - la
  })
}

export const selectBookmarkLocations =
  (s: BookmarkStore) =>
  (id: string): BookmarkLocation[] => {
    const result: BookmarkLocation[] = []
    s.groups.forEach((g) => {
      g.children.forEach((sub) => {
        if (sub.bookmarkIds.includes(id)) {
          result.push({ groupId: g.id, subGroupId: sub.id })
        }
      })
    })
    return result
  }

export { uid }
