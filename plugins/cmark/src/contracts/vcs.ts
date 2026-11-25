/**
 * VcsPort —— 结构化版本控制
 *
 * 关键设计：语义级接口，不返回 git 的 stdout。
 * 原因：系统 git 与 isomorphic-git / libgit2 的输出完全不同，
 * 一旦契约里出现 "解析 porcelain 字符串"，换引擎就得重写业务层。
 *
 * 从现有 git-service.js 提炼、必须保留的纪律：
 *  - 路径按字面量（等价 GIT_LITERAL_PATHSPECS=1），每条 rel 过规范化校验
 *  - 拉取只用 ff-only；分叉返回 diverged，不自动 rebase、不写冲突标记
 *  - 禁止 reset --hard / clean -fdx / push --force
 *  - 丢弃改动必须连暂存区一起清，之后 diff 与 diff --cached 都空才算成功
 *  - 全局串行：一条命令一个超时，不并发
 *  - 备份失败必须中止
 */
import type { VcsProtocol } from './caps'
import type { Result } from './result'

export type ChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'

export interface StatusEntry {
  path: string
  /** renamed 时的原路径 */
  origPath?: string
  kind: ChangeKind
  /** 是否已进暂存区 */
  staged: boolean
}

export interface Identity {
  name: string
  email: string
}

export interface CommitInfo {
  oid: string
  short: string
  message: string
  author: Identity
  /** ISO 时间串 */
  date: string
  parents: string[]
}

export interface HunkLine {
  type: ' ' | '+' | '-'
  text: string
}

export interface Hunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: HunkLine[]
}

export interface FileDiff {
  path: string
  binary: boolean
  added: number
  removed: number
  hunks: Hunk[]
}

export interface RepoState {
  repoRoot: string | null
  branch: string | null
  upstream: string | null
}

export interface StatusResult {
  entries: StatusEntry[]
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
}

export interface RemoteInfo {
  name: string
  url: string
}

export interface ProbeResult {
  defaultBranch: string | null
  heads: string[]
}

export interface LogOptions {
  depth?: number
  skip?: number
  /** 只看某个文件的提交历史 */
  path?: string
  /** 跟随改名 */
  follow?: boolean
}

export interface DiffOptions {
  /** true = 对比暂存区与 HEAD；false = 对比工作区与暂存区 */
  staged?: boolean
  /** 起始提交；缺省为 HEAD */
  from?: string
  /** 目标：'worktree' 或某个提交 oid / ref */
  to?: 'worktree' | string
  path?: string
}

export interface InitOptions {
  branch?: string
  remoteUrl?: string
  identity?: Identity
  /** 建好后把现有笔记做成首次提交 */
  firstCommit?: boolean
}

export interface AdoptOptions {
  remoteUrl: string
  branch?: string
  identity?: Identity
}

export interface PullResult {
  strategy: 'ff-only'
  fastForwarded: boolean
  /** 本地与远端分叉，需要用户决策 */
  diverged: boolean
}

export interface PushResult {
  /** 被远端拒绝（non-fast-forward） */
  rejected: boolean
}

export interface VcsPort {
  readonly protocols: readonly VcsProtocol[]

  detect(): Promise<Result<RepoState>>
  init(o?: InitOptions): Promise<Result<{ branch: string }>>
  adopt(o: AdoptOptions): Promise<Result<{ branch: string }>>

  status(o?: { paths?: string[] }): Promise<Result<StatusResult>>
  log(o?: LogOptions): Promise<Result<{ commits: CommitInfo[]; total: number }>>
  /** 读某次提交里的文件内容；path 省略时返回提交对象摘要 */
  show(oid: string, path?: string): Promise<Result<Uint8Array>>
  diff(o?: DiffOptions): Promise<Result<FileDiff[]>>

  stage(paths: string[] | 'all'): Promise<Result<void>>
  unstage(paths: string[]): Promise<Result<void>>
  /** 丢弃工作区改动；实现必须同时清暂存区 */
  discard(paths: string[]): Promise<Result<void>>
  /** 把某个提交里的文件写回工作区（回溯） */
  restore(oid: string, path: string): Promise<Result<void>>
  commit(message: string, identity?: Identity): Promise<Result<{ oid: string }>>

  remotes(): Promise<Result<RemoteInfo[]>>
  setRemote(url: string, name?: string): Promise<Result<void>>
  /** 探测远端：不需要授权时可传空 token */
  probeRemote(url: string, token?: string): Promise<Result<ProbeResult>>

  fetch(o?: { prune?: boolean }): Promise<Result<void>>
  push(): Promise<Result<PushResult>>
  pull(): Promise<Result<PullResult>>

  /** 令牌只存本机偏好，不进仓库 */
  setCredential(c: { token: string; username?: string; url?: string } | null): void
}