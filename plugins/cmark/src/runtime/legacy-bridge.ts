/**
 * 唯一接缝：全项目只有这个文件允许访问 window.__*（preload 注入的桥）。
 *
 * 为什么要有它：
 *   迁移前 window.__CMARK / __ZNOTES / __NDB / __znotesGit / ztools 直接散落在 13 个
 *   组件与 store 里（60 处），换平台等于全量重写。现在所有平台访问收敛到本文件，
 *   业务代码只认这里的函数名；换端时只替换本文件的实现（或改为转发到端口）。
 *
 * 与 contracts/ 的关系：
 *   - 本文件是「同步的 legacy 桥」，保留现有调用习惯，零时序风险
 *   - contracts/ 是「异步的目标契约」，新代码优先走 contracts + runtime
 *   - 门禁（scripts/check-ports.mjs）只允许本文件出现 window.__*
 *
 * 注意：这里的方法签名刻意与 preload 保持一致（含返回 { ok, message } 的写法），
 * 因为 60 个调用点依赖这些细节。要改语义请改 contracts，不要改这里。
 */
import type { TreeNode } from '../contracts/index'

export interface TreeBridgeResult {
  workspace?: string
  children: TreeNode[]
  truncated: boolean
}

export interface NoteState {
  locked?: boolean
  near?: boolean
}

export interface OpBridgeResult {
  ok: boolean
  message?: string
  rel?: string
  canceled?: boolean
  mtime?: number
  path?: string
  url?: string
}

export interface ReadBridgeResult {
  ok: boolean
  text?: string
  mtime?: number
  size?: number
  message?: string
  code?: string
}

/** window.__CMARK：笔记数据层 + 文件杂项 */
export interface NotesApi {
  listTree(): TreeBridgeResult
  readNote(rel: string): string
  readNoteEx?(rel: string): ReadBridgeResult | null
  statNote?(rel: string): { ok?: boolean; mtime?: number; size?: number; code?: string } | null
  writeNote(rel: string, text: string): OpBridgeResult
  exists(rel: string): boolean
  absOf?(rel: string): string

  createNote(dirRel: string, name: string, text?: string): OpBridgeResult
  createFolder(dirRel: string, name: string): OpBridgeResult
  renameNode(rel: string, newName: string): OpBridgeResult
  deleteNode(rel: string): OpBridgeResult
  duplicateNode?(rel: string): OpBridgeResult
  moveNode(rel: string, targetDirRel: string): OpBridgeResult
  countInDir(rel: string): number

  saveOrder?(tree: TreeNode[]): OpBridgeResult
  loadAllNotes?(): { rel: string; text: string }[]

  pickWorkspace?(): OpBridgeResult
  onWorkspaceChange(cb: () => void): void

  openExternal?(url: string): void
  /** 用系统默认程序打开笔记文件；返回 Promise（preload 侧用 electron.shell.openPath 拿真实错误） */
  openNoteInBrowser?(rel: string): Promise<{ ok: boolean; message?: string }>
  shellShowItem?(rel: string): OpBridgeResult
  shellShowWorkspace?(): void

  pickImageFile?(): { ok: boolean; path?: string; canceled?: boolean; message?: string }
  saveImageToWorkspace?(srcPath?: string, base64?: string, noteRel?: string): OpBridgeResult | null
  saveClipboardImage?(name: string): OpBridgeResult
  resolveImageUrl?(s: string): string

  countMarkdown?(dir?: string): { markdown: number; folders: number }
  rescan?(): unknown
  getConfig?(): { workspace: string; initialized: boolean; workspaceExists: boolean }
}

/** window.__ZNOTES：笔记状态（只读锁定、全局搜索标记、md↔节点、引导标记） */
export interface NoteStateApi {
  readNoteState?(rel: string): NoteState | null
  setNoteLocked?(rel: string, on: boolean): OpBridgeResult
  setNoteNear?(rel: string, on: boolean): OpBridgeResult
  toNodes?(md: string): unknown
  toMarkdown?(nodes: unknown): string
  onboardGet?(): Record<string, unknown>
  onboardSet?(d: Record<string, unknown>): void
  metaDir?: string
}

/** window.__NDB：底层数据层（只用到 allDocs） */
export interface DbApi {
  allDocs?(prefix?: string): Array<{ _id?: string }>
}

/** 宿主对象（ZTools / uTools 同名 API） */
export interface HostApi {
  showNotification?(o: { title: string; body?: string } | string, body?: string): void
  setFeature?(o: { code: string; icon?: string; explain?: string; cmds?: string[] }): void
  removeFeature?(code: string): void
  getPath?(name: string): string
  showOpenDialog?(o: unknown): string | string[] | null
  showSaveDialog?(o: unknown): string | null
  createBrowserWindow?(o: unknown): unknown
  copyText?(t: string): void
  shellOpenExternal?(url: string): void
  shellOpenPath?(p: string): void
  shellShowItemInFolder?(p: string): void
  getCopyedFiles?(): Array<{ path: string }>
  setSubInputValue?(v: string): void
  onPluginEnter?(cb: (p: unknown) => void): void
  [k: string]: unknown
}

/** 无桥时给一个空对象：调用方会在首次方法调用时暴露问题，与迁移前行为一致 */
function pick<T>(key: string): T | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as Record<string, T | undefined>)[key]
}

/** 笔记数据层。没有桥时返回空对象（与迁移前一致：调用即报错，便于快速发现） */
export function notes(): NotesApi {
  return (pick<NotesApi>('__CMARK') || ({} as NotesApi))
}

export function hasNotes(): boolean {
  return !!pick<NotesApi>('__CMARK')
}

/** 笔记状态层（只读 / 全局搜索 / md 转换 / 引导） */
export function noteState(): NoteStateApi | undefined {
  return pick<NoteStateApi>('__ZNOTES')
}

/** 底层数据层 */
export function db(): DbApi | undefined {
  return pick<DbApi>('__NDB')
}

/** Git 服务层：接口由各调用点自行断言，避免把 1500 行 git 服务的方法全搬进类型 */
export function gitBridge<T>(): T | undefined {
  return pick<T>('__znotesGit')
}

/** 宿主能力（ZTools/uTools） */
export function hostApi(): HostApi | undefined {
  return pick<HostApi>('__ztools') || pick<HostApi>('__utools')
}

/** 启动期错误（preload 挂载失败时写入） */
export function bootErrors(): string[] {
  return pick<string[]>('__CMARK_BOOT_ERRORS') || []
}

/** 当前工作区绝对路径（部分组件用于展示） */
export function workspacePath(): string {
  return pick<string>('__ZNOTES_WS') || ''
}