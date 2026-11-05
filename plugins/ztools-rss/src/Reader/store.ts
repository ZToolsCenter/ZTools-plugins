import { reactive, computed, readonly } from 'vue'
import {
  type GReaderConfig,
  type Subscription,
  type TreeNode,
  type Article,
  SPECIAL_ALL,
  SPECIAL_STARRED,
  STATE_READING_LIST,
  STATE_STARRED
} from './types'
import * as api from './api'

const CONFIG_KEY = 'ztools-rss:config'

interface ReaderState {
  config: GReaderConfig | null
  authed: boolean
  loading: boolean
  error: string
  tree: TreeNode[]
  selectedStreamId: string
  selectedNodeId: string
  articles: Article[]
  articlesContinuation: string | null
  selectedArticleId: string
  loadingMore: boolean
  unreadMap: Record<string, number>
}

const state = reactive<ReaderState>({
  config: null,
  authed: false,
  loading: false,
  error: '',
  tree: [],
  selectedStreamId: '',
  selectedNodeId: '',
  articles: [],
  articlesContinuation: null,
  selectedArticleId: '',
  loadingMore: false,
  unreadMap: {}
})

function loadConfig(): GReaderConfig | null {
  try {
    const raw = window.ztools.dbStorage.getItem<GReaderConfig>(CONFIG_KEY)
    if (raw && raw.baseUrl && raw.username) return raw
  } catch (_) {
    // ignore
  }
  return null
}

export function saveConfig(config: GReaderConfig): void {
  window.ztools.dbStorage.setItem(CONFIG_KEY, config)
  state.config = { ...config }
}

function countUnread(id: string): number {
  return state.unreadMap[id] || 0
}

function resolveIcon(baseUrl: string, iconUrl?: string): string | undefined {
  if (!iconUrl) return undefined
  if (/^https?:\/\//i.test(iconUrl)) return iconUrl
  try {
    const u = new URL(baseUrl)
    return u.origin + (iconUrl.startsWith('/') ? iconUrl : '/' + iconUrl)
  } catch (_) {
    return undefined
  }
}

export function buildTree(
  subscriptions: Subscription[],
  unreadMap: Record<string, number>,
  baseUrl = ''
): TreeNode[] {
  const totalUnread = unreadMap[STATE_READING_LIST] || 0
  const starredUnread = unreadMap[STATE_STARRED] || 0

  const specials: TreeNode[] = [
    {
      type: 'special',
      id: SPECIAL_ALL,
      title: '全部文章',
      unread: totalUnread,
      streamId: STATE_READING_LIST,
      collapsed: false
    },
    {
      type: 'special',
      id: SPECIAL_STARRED,
      title: '星标文章',
      unread: starredUnread,
      streamId: STATE_STARRED,
      collapsed: false
    }
  ]

  const folders = new Map<string, TreeNode>()
  const orphans: TreeNode[] = []
  const UNCATEGORIZED = '未分类'

  const subs = [...subscriptions].sort((a, b) =>
    (a.title || '').localeCompare(b.title || '', 'zh')
  )

  for (const sub of subs) {
    const node: TreeNode = {
      type: 'feed',
      id: sub.id,
      title: sub.title || sub.url || sub.id,
      unread: unreadMap[sub.id] || 0,
      streamId: sub.id,
      iconUrl: resolveIcon(baseUrl, sub.iconUrl)
    }
    if (sub.categories && sub.categories.length > 0) {
      const label = sub.categories[0].label || UNCATEGORIZED
      const folderId = 'folder:' + label
      let folder = folders.get(folderId)
      if (!folder) {
        folder = {
          type: 'folder',
          id: folderId,
          title: label,
          unread: 0,
          streamId: 'user/-/label/' + label,
          collapsed: false,
          children: []
        }
        folders.set(folderId, folder)
      }
      folder.children!.push(node)
      folder.unread += node.unread
    } else {
      orphans.push(node)
    }
  }

  const folderNodes = [...folders.values()].sort((a, b) =>
    a.title.localeCompare(b.title, 'zh')
  )
  return [...specials, ...folderNodes, ...orphans]
}

export async function init(): Promise<void> {
  if (typeof window === 'undefined' || !window.ztools) {
    state.error = '请在 ZTools 中打开本插件'
    return
  }
  state.config = loadConfig()
  if (state.config) {
    await ensureAuthed()
  }
}

export async function ensureAuthed(): Promise<boolean> {
  if (!state.config) return false
  if (state.authed && api.isAuthed()) return true
  state.loading = true
  state.error = ''
  try {
    await api.login(state.config)
    state.authed = true
    await refreshTree()
    return true
  } catch (e: any) {
    state.error = e.message || String(e)
    state.authed = false
    return false
  } finally {
    state.loading = false
  }
}

export async function refreshTree(): Promise<void> {
  if (!state.config) return
  try {
    const [subResp, unreadResp] = await Promise.all([
      api.fetchSubscriptionList(state.config),
      api.fetchUnreadCount(state.config)
    ])
    const unreadMap: Record<string, number> = {}
    for (const u of unreadResp.unreadcounts || []) {
      unreadMap[u.id] = (unreadMap[u.id] || 0) + u.count
    }
    state.unreadMap = unreadMap
    const prevSelected = state.selectedStreamId
    state.tree = buildTree(subResp.subscriptions || [], unreadMap, state.config.baseUrl)
    // 默认选中“全部文章”
    if (!prevSelected || !nodeExists(state.tree, prevSelected)) {
      await selectNode(SPECIAL_ALL)
    } else {
      await selectStream(state.selectedNodeId, prevSelected)
    }
  } catch (e: any) {
    state.error = e.message || String(e)
  }
}

/** 刷新当前订阅源：保留选中节点，重载树(未读计数)与当前流的文章 */
export async function refreshCurrent(): Promise<void> {
  if (!state.config || !state.selectedStreamId) return
  state.loading = true
  state.error = ''
  try {
    const [subResp, unreadResp] = await Promise.all([
      api.fetchSubscriptionList(state.config),
      api.fetchUnreadCount(state.config)
    ])
    const unreadMap: Record<string, number> = {}
    for (const u of unreadResp.unreadcounts || []) {
      unreadMap[u.id] = (unreadMap[u.id] || 0) + u.count
    }
    state.unreadMap = unreadMap
    state.tree = buildTree(subResp.subscriptions || [], unreadMap, state.config.baseUrl)
    // 保留当前选中流，仅重载文章列表
    state.articles = []
    state.articlesContinuation = null
    state.selectedArticleId = ''
    await loadArticles(true)
  } catch (e: any) {
    if (e.message && /登录已失效/.test(e.message)) state.authed = false
    state.error = e.message || String(e)
  } finally {
    state.loading = false
  }
}

function nodeExists(tree: TreeNode[], streamId: string): boolean {
  for (const n of tree) {
    if (n.streamId === streamId) return true
    if (n.children && nodeExists(n.children, streamId)) return true
  }
  return false
}

export async function selectNode(nodeId: string): Promise<void> {
  const node = findNode(state.tree, nodeId)
  if (!node) return
  await selectStream(nodeId, node.streamId)
}

async function selectStream(nodeId: string, streamId: string): Promise<void> {
  state.selectedNodeId = nodeId
  state.selectedStreamId = streamId
  state.selectedArticleId = ''
  state.articles = []
  state.articlesContinuation = null
  await loadArticles(true)
}

function findNode(tree: TreeNode[], id: string): TreeNode | null {
  for (const n of tree) {
    if (n.id === id) return n
    if (n.children) {
      const r = findNode(n.children, id)
      if (r) return r
    }
  }
  return null
}

export async function loadArticles(first: boolean): Promise<void> {
  if (!state.config || !state.selectedStreamId) return
  if (first) state.loading = true
  else state.loadingMore = true
  state.error = ''
  try {
    const resp = await api.fetchArticles(state.config, state.selectedStreamId, {
      onlyUnread: false,
      n: first ? 40 : 40,
      continuation: first ? undefined : state.articlesContinuation || undefined
    })
    const mapped = api.mapArticles(resp)
    if (first) state.articles = mapped
    else {
      const ids = new Set(state.articles.map((a) => a.id))
      state.articles.push(...mapped.filter((a) => !ids.has(a.id)))
    }
    state.articlesContinuation = resp.continuation || null
    // 默认选中第一篇
    if (first && state.articles.length > 0 && !state.selectedArticleId) {
      state.selectedArticleId = state.articles[0].id
      void markCurrentRead()
    }
  } catch (e: any) {
    if (e.message && /登录已失效/.test(e.message)) state.authed = false
    state.error = e.message || String(e)
  } finally {
    state.loading = false
    state.loadingMore = false
  }
}

export function selectArticle(id: string): void {
  state.selectedArticleId = id
  void markCurrentRead()
}

export const currentArticle = computed<Article | null>(() => {
  return state.articles.find((a) => a.id === state.selectedArticleId) || null
})

async function markCurrentRead(): Promise<void> {
  if (!state.config || !state.selectedArticleId) return
  const article = currentArticle.value
  if (!article || article.read) return
  article.read = true
  // 更新未读计数
  const node = findNode(state.tree, state.selectedNodeId)
  if (node && node.unread > 0) node.unread -= 1
  try {
    await api.markItemRead(state.config, article.id, true)
  } catch (_) {
    // 静默失败，不打断阅读
  }
}

export async function toggleStar(article: Article): Promise<void> {
  if (!state.config) return
  const next = !article.starred
  article.starred = next
  try {
    await api.markItemStarred(state.config, article.id, next)
  } catch (_) {
    article.starred = !next
  }
}

export async function markAllReadInCurrent(): Promise<void> {
  if (!state.config || !state.selectedStreamId) return
  try {
    await api.markStreamRead(state.config, state.selectedStreamId)
    for (const a of state.articles) a.read = true
    const node = findNode(state.tree, state.selectedNodeId)
    if (node) node.unread = 0
  } catch (e: any) {
    state.error = e.message || String(e)
  }
}

export function toggleFolder(nodeId: string): void {
  const node = findNode(state.tree, nodeId)
  if (node && node.type === 'folder') node.collapsed = !node.collapsed
}

export function resetError(): void {
  state.error = ''
}

export function logout(): void {
  api.logout()
  state.authed = false
  state.tree = []
  state.articles = []
  state.selectedStreamId = ''
  state.selectedNodeId = ''
  state.selectedArticleId = ''
}

export const store = readonly(state)
