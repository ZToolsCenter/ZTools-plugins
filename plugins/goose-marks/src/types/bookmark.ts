export type IconSource =
  | { type: 'file'; path: string; hash?: string; fetchedAt?: number; bgColor?: string }
  | { type: 'remote'; src: string; cache?: string; fetchedAt?: number; bgColor?: string }
  | { type: 'text'; value: string; bgColor?: string }
  | { type: 'custom'; data: string; bgColor?: string }

export interface BookmarkLocation {
  groupId: string
  subGroupId: string
}

export interface Bookmark {
  id: string
  title: string
  url: string
  desc?: string
  tags: string[]
  icon?: IconSource
  pinned?: boolean
  locations?: BookmarkLocation[]  // 支持多分组，可选以保持向后兼容
  prevLocations?: BookmarkLocation[] // 移入回收站前的原始位置，用于还原
  allowUniversal?: boolean // 是否注册为 uTools 全局搜索（主输入框任意内容匹配）
  iconMatchedAt?: number
  iconMatchFailedAt?: number
  iconMatchFailedReason?: string

  // 本地使用排序数据：驱动「最近使用」虚拟视图与访问次数排序。
  // 旧数据无此字段时按 undefined / 0 处理，向后兼容。
  lastUsed?: number  // 最后一次打开的时间戳（ms）
  visits?: number    // 累计访问次数，默认 0

  // 元数据字段，用于增量同步与离线冲突解决
  createdAt: number
  updatedAt: number
  serverUpdatedAt?: number
  isDeleted?: boolean
}

export interface SubGroup {
  id: string
  name: string
  bookmarkIds: string[]
  lastSyncedAt?: number   // 最后同步时间
  
  // 元数据字段
  createdAt: number
  updatedAt: number
  serverUpdatedAt?: number
  isDeleted?: boolean
}

export interface Group {
  id: string
  name: string
  children: SubGroup[]
  lastSyncedAt?: number   // 最后同步时间
  
  // 元数据字段
  createdAt: number
  updatedAt: number
  serverUpdatedAt?: number
  isDeleted?: boolean
}
