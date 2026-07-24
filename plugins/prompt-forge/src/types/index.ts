/** 变量定义 */
export interface Variable {
  name: string
  required: boolean
  defaultValue?: string
}

/** 版本快照 */
export interface Snapshot {
  version: number
  body: string
  note: string
  createdAt: number
}

/** 提示词类型 */
export type PromptType = 'prompt' | 'snippet' | 'template' | 'constraint'

/** 提示词单元 */
export interface PromptItem {
  id: string
  title: string
  description?: string
  content: string
  type: PromptType
  tags: string[]
  variables: Variable[]
  favorite: boolean
  usageCount: number
  projectId?: string
  deleted?: boolean
  version: number
  snapshots: Snapshot[]
  createdAt: number
  updatedAt: number
  lastUsedAt?: number
}

/** 项目 */
export type ProjectGroup = '开发' | '学习' | '写作' | '研究' | '其他'

export interface Project {
  id: string
  name: string
  group: ProjectGroup
  description?: string
  createdAt: number
  updatedAt: number
}

/** 搜索结果 */
export interface SearchResult {
  item: PromptItem
  score: number
}

/** 使用历史记录 */
export interface HistoryEntry {
  id: string
  promptId: string
  promptTitle: string
  copiedContent: string
  /** 变量填写值快照 */
  variableValues?: Record<string, string>
  usedAt: number
}

/** DB 文档格式 */
export interface PromptDoc {
  _id: string
  _rev?: string
  data: PromptItem
}
