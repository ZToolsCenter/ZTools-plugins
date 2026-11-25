/**
 * 端口聚合
 *
 * 应用启动时由各端入口（apps/*）装配一次，之后全局只读。
 * 业务代码只 import 这里，不 import 任何 adapters。
 */
import type { EnvPort } from './env'
import type { WorkspacePort } from './workspace'
import type { VcsPort } from './vcs'
import type { PrefsPort } from './prefs'
import type { ShellPort } from './shell'
import type { ExportPort } from './export'

export interface Ports {
  env: EnvPort
  ws: WorkspacePort
  vcs: VcsPort
  prefs: PrefsPort
  shell: ShellPort
  export: ExportPort
}

export type {
  ActivatePayload,
  EnvPaths,
  EnvPort,
} from './env'
export type {
  ChangeSet,
  NoteState,
  OnboardData,
  ReadResult,
  Stat,
  TreeResult,
  TreeNode,
  WorkspacePort,
  WriteResult,
} from './workspace'
export type {
  AdoptOptions,
  ChangeKind,
  CommitInfo,
  DiffOptions,
  FileDiff,
  Hunk,
  HunkLine,
  Identity,
  InitOptions,
  LogOptions,
  ProbeResult,
  PullResult,
  PushResult,
  RemoteInfo,
  RepoState,
  StatusEntry,
  StatusResult,
  VcsPort,
} from './vcs'
export type { PrefNs, PrefValue, PrefsPort } from './prefs'
export type {
  AiChatHandle,
  AiModel,
  AiRequest,
  NotifyOptions,
  PickFileOptions,
  SaveFileOptions,
  ShellPort,
} from './shell'
export type { ExportFile, ExportPort, RenderOptions, SaveBytesOptions } from './export'
export type { Capabilities, HostKind, Platform, VcsProtocol } from './caps'
export { DESKTOP_CAPS, MINIMAL_CAPS, MOBILE_CAPS } from './caps'
export type { ErrorCode, Fail, Ok, Result, Unsubscribe } from './result'
export { fail, ok } from './result'