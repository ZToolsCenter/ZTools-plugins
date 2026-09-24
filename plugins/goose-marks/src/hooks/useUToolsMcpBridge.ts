import { useEffect } from 'react'
import PinyinMatch from 'pinyin-match'
import type { Bookmark, BookmarkLocation, Group } from '@/types/bookmark'
import { useBookmarkStore, TRASH_GROUP_ID } from '@/stores/bookmark'

/**
 * uTools MCP 工具桥接（React 端）
 * --------------------------------------------------------------------------
 * preload/preload.cjs 通过 utools.registerTool 注册 plugin.json 的 MCP 工具，
 * 工具执行时向渲染层派发 MCP_TOOL_REQUEST_EVENT，并等待渲染层回 MCP_TOOL_RESPONSE_EVENT。
 * 协议：
 *   - 渲染层挂载后：window.__gooseMarksMcpReady = true + 派发 MCP_TOOL_READY_EVENT
 *   - 收到 { requestId, tool, params } → 在 bookmark store 上执行 → 回
 *     { requestId, ok: true, result } 或 { requestId, ok: false, error }
 *
 * 这是 uTools 契约的渲染层实现：让 plugin.json 声明的工具（get_bookmark_tree /
 * list_groups / list_bookmarks 等）能从 React 端取得并操作书签数据。
 */

const MCP_TOOL_REQUEST_EVENT = 'goose-marks:mcp-tool-request'
const MCP_TOOL_RESPONSE_EVENT = 'goose-marks:mcp-tool-response'
const MCP_TOOL_READY_EVENT = 'goose-marks:mcp-tool-ready'

const MCP_TOOL_CAPABILITIES = {
  protocol: 'utools-mcp-tools',
  version: '1.0',
  transport: 'uTools plugin.json.tools + utools.registerTool',
  tools: [
    'get_mcp_capabilities',
    'get_bookmark_tree',
    'list_groups',
    'list_bookmarks',
    'search_bookmarks',
    'get_bookmark',
    'open_bookmark',
    'create_group',
    'update_group',
    'remove_group',
    'create_sub_group',
    'update_sub_group',
    'remove_sub_group',
    'create_bookmark',
    'update_bookmark',
    'set_bookmark_locations',
    'remove_bookmark',
    'restore_bookmark'
  ],
  writeSafety: '写入工具直接修改本地书签库；调用方应在执行前取得用户确认。'
} as const

type ToolParams = Record<string, unknown>

const str = (value: unknown): string => (typeof value === 'string' ? value : '')
const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const getStore = () => useBookmarkStore.getState()

const serializeBookmark = (bookmark: Bookmark, store = getStore()) => ({
  id: bookmark.id,
  title: bookmark.title,
  url: bookmark.url,
  desc: bookmark.desc ?? '',
  tags: bookmark.tags ?? [],
  pinned: bookmark.pinned ?? false,
  allowUniversal: bookmark.allowUniversal ?? false,
  createdAt: bookmark.createdAt,
  updatedAt: bookmark.updatedAt,
  locations: store.getBookmarkLocations(bookmark.id),
  inTrash: store.isBookmarkInTrash(bookmark)
})

const serializeSubGroup = (sub: Group['children'][number], includeBookmarks = false, store = getStore()) => ({
  id: sub.id,
  name: sub.name,
  bookmarkCount: sub.bookmarkIds.length,
  bookmarkIds: [...sub.bookmarkIds],
  ...(includeBookmarks
    ? {
        bookmarks: sub.bookmarkIds
          .map((id) => store.bookmarks.find((b) => b.id === id))
          .filter((b): b is Bookmark => !!b)
          .map((b) => serializeBookmark(b, store))
      }
    : {})
})

const serializeGroup = (group: Group, includeBookmarks = false, store = getStore()) => ({
  id: group.id,
  name: group.name,
  isTrash: group.id === TRASH_GROUP_ID,
  createdAt: group.createdAt,
  updatedAt: group.updatedAt,
  subGroups: group.children.map((sub) => serializeSubGroup(sub, includeBookmarks, store))
})

const findBookmark = (id: string): Bookmark | undefined => getStore().bookmarks.find((b) => b.id === id)

const resolveLocations = (params: ToolParams): BookmarkLocation[] => {
  const raw = params.locations
  if (Array.isArray(raw)) {
    return raw
      .map((loc) => {
        if (!loc || typeof loc !== 'object') return null
        const groupId = str((loc as ToolParams).groupId)
        const subGroupId = str((loc as ToolParams).subGroupId)
        if (!groupId || !subGroupId) return null
        return { groupId, subGroupId }
      })
      .filter((loc): loc is BookmarkLocation => !!loc)
  }
  const groupId = str(params.groupId)
  const subGroupId = str(params.subGroupId)
  if (groupId && subGroupId) return [{ groupId, subGroupId }]
  return []
}

/** 工具执行表：每个工具返回可序列化的结果（同步或异步） */
const executeTool = async (tool: string, params: ToolParams): Promise<unknown> => {
  const store = getStore()

  switch (tool) {
    case 'get_mcp_capabilities':
      return MCP_TOOL_CAPABILITIES

    case 'get_bookmark_tree': {
      // plugin.json 契约：includeBookmarks 默认 true，includeTrash 默认 false。
      const includeBookmarks = params.includeBookmarks !== false
      const includeTrash = !!params.includeTrash
      return {
        groups: store.groups
          .filter((g) => (includeTrash ? true : g.id !== TRASH_GROUP_ID))
          .map((g) => serializeGroup(g, includeBookmarks, store))
      }
    }

    case 'list_groups':
      return {
        groups: store.groups
          .filter((g) => (params.includeTrash ? true : g.id !== TRASH_GROUP_ID))
          .map((g) => serializeGroup(g, false, store))
      }

    case 'list_bookmarks': {
      const groupId = str(params.groupId)
      const subGroupId = str(params.subGroupId)
      const includeTrash = !!params.includeTrash
      let pool = store.bookmarks.filter((b) => includeTrash || !store.isBookmarkInTrash(b))
      if (groupId || subGroupId) {
        pool = pool.filter((b) => {
          const locs = store.getBookmarkLocations(b.id)
          return locs.some(
            (loc) => (!groupId || loc.groupId === groupId) && (!subGroupId || loc.subGroupId === subGroupId)
          )
        })
      }
      // plugin.json 契约：limit 默认 100（1-500），offset 默认 0。
      const total = pool.length
      const limit = Math.min(500, Math.max(1, Math.round(num(params.limit, 100))))
      const offset = Math.max(0, Math.round(num(params.offset, 0)))
      const page = pool.slice(offset, offset + limit)
      return { total, limit, offset, bookmarks: page.map((b) => serializeBookmark(b, store)) }
    }

    case 'search_bookmarks': {
      const query = str(params.query).trim().toLowerCase()
      const limit = Math.min(200, Math.max(1, Math.round(num(params.limit, 50))))
      const groupId = str(params.groupId)
      const subGroupId = str(params.subGroupId)
      const includeTrash = !!params.includeTrash
      if (!query) return { bookmarks: [] }
      const matched = store.bookmarks
        .filter((b) => includeTrash || !store.isBookmarkInTrash(b))
        .filter((b) => {
          // plugin.json 契约：可选 groupId/subGroupId 限制搜索范围。
          if (!groupId && !subGroupId) return true
          const locs = store.getBookmarkLocations(b.id)
          return locs.some(
            (loc) => (!groupId || loc.groupId === groupId) && (!subGroupId || loc.subGroupId === subGroupId)
          )
        })
        .filter((b) => {
          const haystack = [b.title, b.desc ?? '', b.url, (b.tags ?? []).join(' ')].join(' ').toLowerCase()
          // 工具描述承诺拼音搜索：先做子串匹配，再回退拼音匹配（与应用内搜索一致）。
          if (haystack.includes(query)) return true
          return !!PinyinMatch.match(haystack, query)
        })
        .slice(0, limit)
      return { bookmarks: matched.map((b) => serializeBookmark(b, store)) }
    }

    case 'get_bookmark': {
      const id = str(params.id || params.bookmarkId)
      const bookmark = findBookmark(id)
      if (!bookmark) throw new Error(`未找到书签：${id}`)
      return { bookmark: serializeBookmark(bookmark, store) }
    }

    case 'open_bookmark': {
      const id = str(params.id || params.bookmarkId)
      const bookmark = findBookmark(id)
      if (!bookmark) throw new Error(`未找到书签：${id}`)
      const query = str(params.query)
      let url = bookmark.url
      if (/{[^}]+}/.test(url) && query) url = url.replace(/{[^}]+}/g, encodeURIComponent(query))
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url
      const utoolsApi = window.utools as unknown as { shellOpenExternal?: (u: string) => void } | undefined
      if (!utoolsApi?.shellOpenExternal) {
        return { ok: false, error: '当前环境不支持打开链接' }
      }
      utoolsApi.shellOpenExternal(url)
      return { ok: true, url }
    }

    case 'create_group': {
      const name = str(params.name)
      if (!name) throw new Error('分组名称不能为空')
      const group = store.addGroup(name)
      const firstSubGroupName = str(params.firstSubGroupName)
      if (firstSubGroupName && group.children[0]) {
        store.updateSubGroup(group.id, group.children[0].id, firstSubGroupName)
      }
      return { group: serializeGroup(getStore().groups.find((g) => g.id === group.id) ?? group) }
    }

    case 'update_group': {
      const id = str(params.id || params.groupId)
      const name = str(params.name)
      if (!id || !name) throw new Error('缺少分组 id 或名称')
      store.updateGroup(id, name)
      return { ok: true }
    }

    case 'remove_group': {
      const id = str(params.id || params.groupId)
      const ok = store.removeGroup(id)
      return { ok }
    }

    case 'create_sub_group': {
      const groupId = str(params.groupId)
      const name = str(params.name)
      if (!groupId || !name) throw new Error('缺少父分组 id 或子分组名称')
      const sub = store.addSubGroup(name, groupId)
      if (!sub) throw new Error(`未找到父分组：${groupId}`)
      return { subGroup: serializeSubGroup(sub) }
    }

    case 'update_sub_group': {
      const groupId = str(params.groupId)
      const subId = str(params.subGroupId || params.subId)
      const name = str(params.name)
      if (!groupId || !subId || !name) throw new Error('缺少分组/子分组 id 或名称')
      store.updateSubGroup(groupId, subId, name)
      return { ok: true }
    }

    case 'remove_sub_group': {
      const groupId = str(params.groupId)
      const subId = str(params.subGroupId || params.subId)
      const ok = store.removeSubGroup(groupId, subId)
      return { ok }
    }

    case 'create_bookmark': {
      const url = str(params.url)
      if (!url) throw new Error('书签 URL 不能为空')
      const locations = resolveLocations(params)
      const resolvedLocations =
        locations.length > 0
          ? locations
          : [{ groupId: store.activeGroupId, subGroupId: store.activeSubGroupId }]
      const bookmark = store.addBookmark(
        {
          title: str(params.title) || url,
          url,
          desc: str(params.desc),
          tags: Array.isArray(params.tags) ? (params.tags as string[]).map(String) : [],
          pinned: !!params.pinned,
          allowUniversal: !!params.allowUniversal
        },
        resolvedLocations
      )
      return { bookmark: serializeBookmark(bookmark, getStore()) }
    }

    case 'update_bookmark': {
      const id = str(params.id || params.bookmarkId)
      if (!id || !findBookmark(id)) throw new Error(`未找到书签：${id}`)
      const patch: Partial<Bookmark> = {}
      if (typeof params.title === 'string') patch.title = params.title
      if (typeof params.url === 'string') patch.url = params.url
      if (typeof params.desc === 'string') patch.desc = params.desc
      if (Array.isArray(params.tags)) patch.tags = (params.tags as string[]).map(String)
      if (typeof params.pinned === 'boolean') patch.pinned = params.pinned
      if (typeof params.allowUniversal === 'boolean') patch.allowUniversal = params.allowUniversal
      store.updateBookmark(id, patch)
      const updated = findBookmark(id)
      return { bookmark: updated ? serializeBookmark(updated, getStore()) : null }
    }

    case 'set_bookmark_locations': {
      const id = str(params.id || params.bookmarkId)
      if (!id || !findBookmark(id)) throw new Error(`未找到书签：${id}`)
      const locations = resolveLocations(params)
      if (locations.length === 0) throw new Error('locations 不能为空')
      store.updateBookmarkLocations(id, locations)
      return { ok: true }
    }

    case 'remove_bookmark': {
      const id = str(params.id || params.bookmarkId)
      if (!id || !findBookmark(id)) throw new Error(`未找到书签：${id}`)
      store.removeBookmark(id)
      return { ok: true }
    }

    case 'restore_bookmark': {
      const id = str(params.id || params.bookmarkId)
      const ok = store.restoreBookmarkFromTrash(id)
      return { ok }
    }

    default:
      throw new Error(`未知的 MCP 工具：${tool}`)
  }
}

export function useUToolsMcpBridge() {
  useEffect(() => {
    if (typeof window === 'undefined' || !window.utools) return

    const handleRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ requestId?: string; tool?: string; params?: ToolParams }>).detail
      const requestId = detail?.requestId
      const tool = detail?.tool
      if (!requestId || !tool) return

      void (async () => {
        try {
          const result = await executeTool(tool, detail?.params || {})
          window.dispatchEvent(
            new CustomEvent(MCP_TOOL_RESPONSE_EVENT, { detail: { requestId, ok: true, result } })
          )
        } catch (error) {
          window.dispatchEvent(
            new CustomEvent(MCP_TOOL_RESPONSE_EVENT, {
              detail: { requestId, ok: false, error: error instanceof Error ? error.message : String(error) }
            })
          )
        }
      })()
    }

    window.addEventListener(MCP_TOOL_REQUEST_EVENT, handleRequest)
    // 标记桥接就绪，唤醒 preload 中等待 ready 的工具调用
    ;(window as unknown as { __gooseMarksMcpReady?: boolean }).__gooseMarksMcpReady = true
    window.dispatchEvent(new CustomEvent(MCP_TOOL_READY_EVENT))

    return () => {
      window.removeEventListener(MCP_TOOL_REQUEST_EVENT, handleRequest)
    }
  }, [])
}
