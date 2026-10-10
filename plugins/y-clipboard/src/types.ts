/** 内容分类 */
export type ItemKind = 'text' | 'link' | 'code' | 'color' | 'image' | 'file'

export type Category = 'all' | ItemKind | 'star'

/** 归一化后的剪贴板记录（无论宿主返回什么结构，UI 只面对这个） */
export interface ClipboardRecord {
  /** 宿主记录 id（无 id 时用内容 hash 代替） */
  id: string
  /** 分类结果 */
  kind: ItemKind
  /** 原始类型标记 text / image / file ... */
  rawType: string
  /** 文本内容；图片为 dataURL/路径；文件为主路径 */
  content: string
  /** 文件类记录的完整路径列表 */
  files?: string[]
  /** 图片分辨率 "W * H"（宿主提供时） */
  resolution?: string
  /** 复制来源应用（宿主提供时） */
  appName?: string
  /** 宿主的预览文案（图片超大未保存时作为显示兜底） */
  preview?: string
  /** 创建时间戳（ms），未知为 0 */
  createdAt: number
  /** 原始记录，写回宿主时可能需要 */
  raw?: unknown
}

export interface PageResult {
  items: ClipboardRecord[]
  hasMore: boolean
  /** 宿主侧历史总数；宿主没给时为 0，由调用方用 items.length 兜底 */
  total: number
}

export interface FavoriteSnapshot {
  /** 快照 id：生成时基于内容 */
  id: string
  kind: ItemKind
  content: string
  files?: string[]
  createdAt: number
}
