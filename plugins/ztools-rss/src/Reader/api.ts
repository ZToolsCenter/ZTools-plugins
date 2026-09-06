import DOMPurify from 'dompurify'
import {
  type GReaderConfig,
  type SubscriptionListResponse,
  type UnreadCountResponse,
  type StreamContentsResponse,
  type Article,
  type StreamItem,
  STATE_READ,
  STATE_STARRED,
  STATE_READING_LIST
} from './types'

// 给所有 <img> 加 referrerpolicy / loading，规避部分防盗链（空 Referer 放行的 CDN）
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName === 'IMG') {
    node.setAttribute('referrerpolicy', 'no-referrer')
    node.setAttribute('loading', 'lazy')
  }
})

const READ_TAG = STATE_READ
const STAR_TAG = STATE_STARRED

let authToken: string | null = null
let editToken: string | null = null

function normalizeBase(baseUrl: string): string {
  return (baseUrl || '').trim().replace(/\/+$/, '')
}

/** ClientLogin 登录，获取 Auth token */
export async function login(config: GReaderConfig): Promise<void> {
  const base = normalizeBase(config.baseUrl)
  if (!base) throw new Error('未配置 API 地址')
  const body = new URLSearchParams({
    service: 'reader',
    Email: config.username,
    Passwd: config.password
  }).toString()
  const res = await window.services.rssFetch(`${base}/accounts/ClientLogin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!res.ok && res.status !== 200) {
    throw new Error('登录失败：' + (res.status === 401 ? '用户名或密码错误' : `HTTP ${res.status}`))
  }
  const match = res.text.match(/^Auth=(.+)$/m)
  if (!match) throw new Error('登录失败：返回数据格式异常')
  authToken = match[1].trim()
  editToken = null
}

export function isAuthed(): boolean {
  return !!authToken
}

export function logout(): void {
  authToken = null
  editToken = null
}

async function apiGet(config: GReaderConfig, pathAndQuery: string): Promise<string> {
  return request(config, pathAndQuery, 'GET', null)
}

async function apiPostForm(
  config: GReaderConfig,
  path: string,
  params: Record<string, string | string[]>
): Promise<string> {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params)) {
    const arr = Array.isArray(v) ? v : [v]
    for (const item of arr) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(item)}`)
  }
  return request(config, path, 'POST', parts.join('&'))
}

async function request(
  config: GReaderConfig,
  pathAndQuery: string,
  method: 'GET' | 'POST',
  body: string | null
): Promise<string> {
  if (!authToken) throw new Error('尚未登录')
  const base = normalizeBase(config.baseUrl)
  const url = `${base}/reader/api/0/${pathAndQuery.replace(/^\/+/, '')}`
  const headers: Record<string, string> = {
    Authorization: `GoogleLogin auth=${authToken}`
  }
  if (method === 'POST') headers['Content-Type'] = 'application/x-www-form-urlencoded'
  const res = await window.services.rssFetch(url, { method, headers, body })
  if (res.status === 401) {
    authToken = null
    editToken = null
    throw new Error('登录已失效，请重新登录')
  }
  if (!res.ok) throw new Error(`请求失败：HTTP ${res.status}`)
  return res.text
}

/** 获取修改操作所需的 session token（FreshRSS 实际为长效） */
async function getEditToken(config: GReaderConfig): Promise<string> {
  if (editToken) return editToken
  editToken = (await apiGet(config, 'token')).trim()
  return editToken
}

export async function fetchSubscriptionList(config: GReaderConfig): Promise<SubscriptionListResponse> {
  const text = await apiGet(config, 'subscription/list?output=json')
  return JSON.parse(text)
}

export async function fetchUnreadCount(config: GReaderConfig): Promise<UnreadCountResponse> {
  const text = await apiGet(config, 'unread-count?output=json&all=true')
  return JSON.parse(text)
}

function encodeStream(streamId: string): string {
  // streamId 作为路径的一部分，保留斜杠，仅编码空格等字符
  return streamId.split('/').map(encodeURIComponent).join('/')
}

export interface FetchArticlesOptions {
  /** 每页数量，默认 40 */
  n?: number
  /** 仅未读 */
  onlyUnread?: boolean
  /** 续接 token */
  continuation?: string
}

export async function fetchArticles(
  config: GReaderConfig,
  streamId: string,
  opts: FetchArticlesOptions = {}
): Promise<StreamContentsResponse> {
  const { n = 40, onlyUnread = true, continuation } = opts
  const params = [`n=${n}`, 'output=json']
  if (onlyUnread) params.push(`xt=${encodeURIComponent(STATE_READ)}`)
  if (continuation) params.push(`c=${encodeURIComponent(continuation)}`)
  const path = `stream/contents/${encodeStream(streamId)}?${params.join('&')}`
  const text = await apiGet(config, path)
  return JSON.parse(text)
}

function parseArticle(item: StreamItem): Article {
  const cats = item.categories || []
  const content = item.content?.content || item.summary?.content || ''
  const link = item.canonical?.[0]?.href || item.alternate?.[0]?.href
  return {
    id: item.id,
    title: item.title || '(无标题)',
    content,
    author: item.author,
    published: (item.published || 0) * 1000,
    link,
    feedId: item.origin?.streamId,
    feedTitle: item.origin?.title,
    feedUrl: item.origin?.htmlUrl || item.origin?.url,
    read: cats.includes(READ_TAG),
    starred: cats.includes(STAR_TAG)
  }
}

export function mapArticles(resp: StreamContentsResponse): Article[] {
  return (resp.items || []).map(parseArticle).sort((a, b) => b.published - a.published)
}

/** 标记单篇文章 已读/未读 */
export async function markItemRead(
  config: GReaderConfig,
  itemId: string,
  read: boolean
): Promise<void> {
  const token = await getEditToken(config)
  const params: Record<string, string | string[]> = { i: itemId, T: token }
  if (read) params.a = READ_TAG
  else params.r = READ_TAG
  await apiPostForm(config, 'edit-tag', params)
}

/** 标记单篇文章 加星/取消加星 */
export async function markItemStarred(
  config: GReaderConfig,
  itemId: string,
  starred: boolean
): Promise<void> {
  const token = await getEditToken(config)
  const params: Record<string, string | string[]> = { i: itemId, T: token }
  if (starred) params.a = STAR_TAG
  else params.r = STAR_TAG
  await apiPostForm(config, 'edit-tag', params)
}

/** 标记整个流为已读 */
export async function markStreamRead(
  config: GReaderConfig,
  streamId: string
): Promise<void> {
  const token = await getEditToken(config)
  await apiPostForm(config, 'mark-all-as-read', {
    s: streamId,
    T: token
  })
}

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['style', 'script'],
    FORBID_ATTR: ['style', 'onload', 'onerror']
  })
}

export const StreamIds = {
  readingList: STATE_READING_LIST,
  starred: STATE_STARRED
}
