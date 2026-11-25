export interface TreeNode {
  id: string
  name: string
  type: 'folder' | 'note'
  rel: string
  mtime?: number
  children?: TreeNode[]
}

export interface TreeResult {
  workspace: string
  children: TreeNode[]
  truncated: boolean
  count: number
}

export interface OpResult {
  ok: boolean
  message?: string
  rel?: string
  canceled?: boolean
  needReload?: boolean
  workspace?: string
  mtime?: number
}

export interface CMarkBridge {
  configPath: string
  getConfig(): { workspace: string; initialized: boolean; workspaceExists: boolean }
  pickWorkspace(): OpResult
  countMarkdown(dir?: string): { markdown: number; folders: number }
  rescan(): unknown
  onWorkspaceChange(fn: (...args: unknown[]) => void): void
  shellShowWorkspace(): void
  absOf(rel: string): string
  readNote(rel: string): string
  readNoteEx?(rel: string): { ok: boolean; text?: string; mtime?: number; size?: number; message?: string; code?: string }
  statNote?(rel: string): { ok: boolean; mtime?: number; size?: number; code?: string }
  writeNote(rel: string, text: string): OpResult
  createNote(dirRel: string, name: string, text?: string): OpResult
  createFolder(dirRel: string, name: string): OpResult
  renameNode(rel: string, newName: string): OpResult
  deleteNode(rel: string): OpResult
  countInDir(rel: string): number
  moveNode(rel: string, targetDirRel: string): OpResult
  listTree(): TreeResult
  openExternal?(url: string): void
  shellShowItem?(rel: string): OpResult
  duplicateNode?(rel: string): OpResult
  saveImageToWorkspace?(srcPath?: string, base64?: string, noteRel?: string): OpResult
  pickImageFile?(): { ok: boolean; path?: string; canceled?: boolean; message?: string }
  saveOrder?(tree: TreeNode[]): OpResult
  exists?(rel: string): boolean
  saveClipboardImage?(name: string): { ok: boolean; url?: string; message?: string }
}

declare global {
  interface Window {
    __ZNOTES_WS?: string
    /** V1.0.0 原版 git 面板（preload/git-panel.js 自带 DOM 与样式） */
    __zgpToggle?: (mode: 'global' | 'file') => void
    __zgpOpen?: (mode: 'global' | 'file') => void
    __zgpIsOpen?: () => boolean
    /** V1.0.0 原版设置面板 */
    __zgsToggle?: () => void
    __zgsOpen?: () => void
    __zgsClose?: () => void
    __zgsIsOpen?: () => boolean
    /** 给 preload 里的原版模块提供宿主钩子 */
    __cmarkHost?: () => {
      currentRel?: string
      flushSave?: () => void
      reloadNote?: (rel: string) => void
      refreshTree?: () => void
      pickDir?: () => void
    }
    __CMARK: CMarkBridge
    __NDB?: Record<string, unknown>
    /** ndb.js 暴露的 Markdown ↔ Slate 节点转换器（单一来源） */
    __ZNOTES?: {
      ws?: string
      rescan?: () => number
      toNodes?: (md: string) => unknown
      toMarkdown?: (nodes: unknown) => string
      saveTreeOrder?: (data: unknown) => void
      reconcileTree?: (data: unknown) => void
      onFsChange?: (fn: () => void) => void
      /** 只读状态：按 rel 查询，内部换算成 locked.txt 里的哈希 */
      readNoteState?: (rel: string) => { locked: boolean; near?: boolean }
      /** 设置/取消只读 */
      setNoteLocked?: (rel: string, on: boolean) => { ok: boolean; message?: string }
      /** 设为/取消全局搜索指令 */
      setNoteNear?: (rel: string, on: boolean) => { ok: boolean; message?: string }
      truncated?: () => boolean
      metaDir?: string
      onboardGet?: () => Record<string, unknown>
      onboardSet?: (data: Record<string, unknown>) => void
    }
    __znotesGit?: Record<string, unknown>
    services?: Record<string, unknown>
    ztools: Record<string, unknown>
  }
}

export {}
