/**
 * Slate 数据模型与类型
 *
 * 节点的**权威定义在 preload/ndb.js**（mdToNodes / nodeToMd），
 * 这里只做类型声明与运行时兜底，保证渲染层与数据层不各写一套转换。
 */
import type { BaseEditor } from 'slate'
import type { ReactEditor } from 'slate-react'
import type { HistoryEditor } from 'slate-history'

export type LeafFormat = {
  text: string
  bold?: boolean
  italic?: boolean
  code?: boolean
  strike?: boolean
  highlight?: boolean
  underline?: boolean
  link?: string
}

export type ParagraphElement = { type: 'paragraph'; children: LeafFormat[] }
export type HeadingElement = { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: LeafFormat[] }
export type BlockquoteElement = { type: 'blockquote'; children: LeafFormat[] }

/** 列表项既可当普通项，也可当任务项（checked 有值即任务项） */
export type ListItemElement = {
  type: 'list-item'
  checked?: boolean
  /** 嵌套层级，0 为顶层；序列化时按层级缩进 */
  depth?: number
  children: LeafFormat[]
}
export type ListElement = {
  type: 'bulleted-list' | 'numbered-list'
  children: ListItemElement[]
}

export type TableCellElement = { type: 'table-cell'; children: LeafFormat[] }
export type TableRowElement = { type: 'table-row'; children: TableCellElement[] }
export type TableElement = {
  type: 'table'
  /** 每列对齐：'' | 'left' | 'center' | 'right' */
  align?: string[]
  children: TableRowElement[]
}

export type CodeBlockElement = { type: 'codeblock'; lang?: string; content?: string; children: LeafFormat[] }
export type HrElement = { type: 'hr'; children: LeafFormat[] }

/** 图片块：url 支持 attachment:<digest> 与普通路径/链接 */
export type ImageElement = {
  type: 'image'
  url: string
  alt?: string
  /** 显示宽度（px）；不设则按原图 */
  width?: number
  children: LeafFormat[]
}

/** 公式块：$$ ... $$ */
export type MathElement = { type: 'math'; value: string; children: LeafFormat[] }

export type CMarkElement =
  | ParagraphElement
  | HeadingElement
  | BlockquoteElement
  | ListElement
  | ListItemElement
  | TableElement
  | TableRowElement
  | TableCellElement
  | CodeBlockElement
  | HrElement
  | ImageElement
  | MathElement

declare module 'slate' {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor & HistoryEditor
    Element: CMarkElement
    Text: LeafFormat
  }
}

/** 空文档：一个空段落（Slate 要求至少一个可编辑块） */
export function emptyDoc(): CMarkElement[] {
  return [{ type: 'paragraph', children: [{ text: '' }] }]
}

/** 从 ndb.js 的 mdToNodes 结果做一次结构校验，坏数据兜底成空文档 */
export function normalizeDoc(nodes: unknown): CMarkElement[] {
  if (!Array.isArray(nodes) || nodes.length === 0) return emptyDoc()
  const ok = nodes.every(
    (n) => n && typeof n === 'object' && Array.isArray((n as { children?: unknown }).children)
  )
  return ok ? (nodes as CMarkElement[]) : emptyDoc()
}

/** 块级元素类型判断（table-row / table-cell / list-item 虽然也是 Element，但不算独立块） */
const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'bulleted-list',
  'numbered-list',
  'table',
  'codeblock',
  'hr',
  'image',
  'math',
])

export function isBlockElement(n: unknown): boolean {
  if (!n || typeof n !== 'object') return false
  const t = (n as { type?: string }).type
  return !!t && BLOCK_TYPES.has(t)
}

/** 行内代码块允许插入换行；其它块不允许 */
export function isCodeBlock(n: unknown): boolean {
  return !!n && typeof n === 'object' && (n as { type?: string }).type === 'codeblock'
}