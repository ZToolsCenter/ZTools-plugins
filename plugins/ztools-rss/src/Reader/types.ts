// Google Reader API 类型定义

export interface GReaderConfig {
  /** API 根地址，如 https://example.com/api/greader.php（不带尾斜杠） */
  baseUrl: string
  /** 用户名 */
  username: string
  /** API 专用密码 */
  password: string
}

export interface FeedCategory {
  id: string
  label: string
}

export interface Subscription {
  id: string
  title: string
  categories: FeedCategory[]
  url?: string
  htmlUrl?: string
  iconUrl?: string
}

export interface SubscriptionListResponse {
  subscriptions: Subscription[]
}

export interface UnreadCount {
  id: string
  count: number
  newestItemTimestampUsec?: string
}

export interface UnreadCountResponse {
  max: number
  unreadcounts: UnreadCount[]
}

export interface ItemAlternate {
  href: string
  type?: string
}

export interface ItemSummary {
  content: string
  direction?: string
}

export interface ItemOrigin {
  streamId?: string
  title?: string
  htmlUrl?: string
  url?: string
}

export interface StreamItem {
  id: string
  title?: string
  summary?: ItemSummary
  content?: ItemSummary
  author?: string
  published?: number
  updated?: number
  crawlTimeMsec?: string
  timestampUsec?: string
  categories?: string[]
  alternate?: ItemAlternate[]
  canonical?: ItemAlternate[]
  origin?: ItemOrigin
}

export interface StreamContentsResponse {
  id: string
  title?: string
  updated?: number
  continuation?: string
  items: StreamItem[]
}

export interface Tag {
  id: string
  type?: string
}

export interface TagListResponse {
  tags: Tag[]
}

// 系统标签常量
export const STATE_READING_LIST = 'user/-/state/com.google/reading-list'
export const STATE_STARRED = 'user/-/state/com.google/starred'
export const STATE_READ = 'user/-/state/com.google/read'
export const STATE_KEPT_UNREAD = 'user/-/state/com.google/kept-unread'

// 特殊节点标识（用于树形结构）
export const SPECIAL_ALL = '__all__'
export const SPECIAL_STARRED = '__starred__'

/** 统一的文章结构 */
export interface Article {
  id: string
  title: string
  content: string
  author?: string
  published: number
  link?: string
  feedId?: string
  feedTitle?: string
  feedUrl?: string
  read: boolean
  starred: boolean
}

/** 树节点类型 */
export type TreeNodeType = 'special' | 'folder' | 'feed'

export interface TreeNode {
  type: TreeNodeType
  id: string
  title: string
  unread: number
  streamId: string
  iconUrl?: string
  collapsed?: boolean
  children?: TreeNode[]
}
