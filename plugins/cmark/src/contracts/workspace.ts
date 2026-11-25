/**
 * WorkspacePort —— 工作区文件系统
 *
 * 铁律（所有适配器都必须遵守，写在这里是为了换平台时不丢）：
 *  1. 所有路径都是「工作区相对路径」rel（`a/b/note.md`），平台自己映射成
 *     绝对路径 / SAF URI / 沙盒路径。业务层永远不拼绝对路径。
 *  2. 内容相同不写盘。写盘用「临时文件 + rename」原子替换。
 *  3. 破坏性操作（move / remove / 回溯）先备份，备份失败必须中止。
 *  4. rel 必须是规范化字面量：拒绝 `..`、绝对路径、`.git` 段。
 *  5. 目标位置若只是上次移动留下的空目录，先删空目录再移动；非空一律跳过不覆盖。
 */
import type { Result, Unsubscribe } from './result'

export interface TreeNode {
  /** 稳定 id：`note/<rel>` 或 `folder/<rel>` */
  id: string
  /** 显示名（不含扩展名） */
  name: string
  type: 'folder' | 'note'
  /** 工作区相对路径 */
  rel: string
  mtime?: number
  children?: TreeNode[]
}

export interface TreeResult {
  children: TreeNode[]
  count: number
  /** 超过 maxEntries 被截断 */
  truncated: boolean
  /** 展示用工作区句柄；移动端是 URI，不可当路径拼 */
  workspace: string | null
}

export interface Stat {
  rel: string
  mtime: number
  size: number
}

export interface ReadResult {
  text: string
  mtime: number
  size: number
}

export interface WriteResult {
  /** 内容与磁盘一致时为 false（没有真正写盘） */
  changed: boolean
  mtime: number
}

export interface ChangeSet {
  /** 新增/修改的 rel */
  changed: string[]
  /** 删除的 rel */
  removed: string[]
}

/** 笔记状态（.cmark/locked.txt、near.txt 的语义视图） */
export interface NoteState {
  locked: boolean
  near: boolean
}

/** 上手引导状态（.cmark/onboard.json） */
export type OnboardData = Record<string, unknown>

export interface WorkspacePort {
  /** 当前绑定的工作区句柄（null = 还没选） */
  root(): string | null
  /** 是否已绑定且目录存在 */
  isReady(): Promise<boolean>

  /** 弹出系统选择器选一个新工作区（不直接切换，由调用方决定何时 adopt） */
  pick(): Promise<Result<string | null>>
  /** 绑定到给定句柄；失败要回滚，不能留半个状态 */
  adopt(root: string): Promise<Result<void>>

  listTree(opts?: { maxEntries?: number }): Promise<TreeResult>
  /** 批量读全部笔记正文（全文索引、搜索、全局搜索指令校准用）。库大时可截断 */
  readAll(): Promise<{ rel: string; text: string }[]>
  read(rel: string): Promise<Result<ReadResult>>
  stat(rel: string): Promise<Result<Stat>>
  write(rel: string, text: string): Promise<Result<WriteResult>>

  create(rel: string, kind: 'note' | 'folder', text?: string): Promise<Result<{ rel: string }>>
  rename(rel: string, newName: string): Promise<Result<{ rel: string }>>
  move(rel: string, targetDirRel: string): Promise<Result<{ rel: string }>>
  /** 进回收站，不硬删 */
  remove(rel: string): Promise<Result<void>>
  duplicate(rel: string): Promise<Result<{ rel: string }>>
  exists(rel: string): Promise<boolean>

  /** 原生监听；caps.fs.watch=false 时返回一个空解绑函数，由 core 轮询兜底 */
  watch(cb: (c: ChangeSet) => void): Unsubscribe

  /** 附件：按内容摘要命名，返回 `attachment:<digest>` 供 markdown 引用 */
  putAttachment(bytes: Uint8Array, ext: string): Promise<Result<{ url: string; rel: string }>>
  readAttachment(ref: string): Promise<Result<Uint8Array>>
  /** 选一张本地图片（移动端走相册） */
  pickImage(): Promise<Result<{ bytes: Uint8Array; name: string } | null>>
  /** 读剪贴板图片（caps.shell.clipboardImage=false 时返回 unsupported） */
  readClipboardImage(): Promise<Result<Uint8Array | null>>

  /** 只读 / 全局搜索标记（.cmark/locked.txt、near.txt 的语义视图） */
  noteState(rel: string): Promise<Result<NoteState>>
  setNoteLocked(rel: string, on: boolean): Promise<Result<void>>
  setNoteNear(rel: string, on: boolean): Promise<Result<void>>
  /** 保存目录树顺序（.cmark/order.txt），拖拽结果持久化 */
  saveOrder(tree: TreeNode[]): Promise<Result<void>>
  /** 上手引导状态（.cmark/onboard.json） */
  readOnboard(): Promise<OnboardData>
  writeOnboard(data: OnboardData): Promise<Result<void>>
}