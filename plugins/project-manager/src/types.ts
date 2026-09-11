import type { FrontendEnvGroup } from './utils/frontendEnvSwitcher';
import type { UiSize } from './utils/uiSize';

/** 内置命令 id：名称在渲染时按当前语言翻译，不写死在数据里 */
export type BuiltinCommandId =
  | 'install_dependencies'
  | 'java_run'
  | 'java_package'
  | 'java_test';

export interface CustomCommand {
  id: string;
  name: string;
  command: string;
  builtinId?: BuiltinCommandId;
}

/***********************运行会话*********************/
export type RunSessionCommandType = 'script' | 'custom';

export type RunSessionStatus =
  | 'starting'
  | 'running'
  | 'stopping'
  | 'success'
  | 'failed'
  | 'stopped';

/** 一次具体命令执行的内存态元数据；不写入 Project/data.json。 */
export interface RunSession {
  sessionId: string;
  /** 稳定命令键，格式为 projectId:script:<name> 或 projectId:custom:<id>。 */
  commandKey: string;

  projectId: string;
  commandType: RunSessionCommandType;
  commandId: string;
  displayName: string;

  cwd: string;
  status: RunSessionStatus;

  startedAt: number;
  endedAt?: number;
  durationMs?: number;

  exitCode?: number | null;
  errorMessage?: string;

  nodeRuntimeId?: string;
  nodeVersion?: string;
  nodePath?: string;
  packageManager?: string;
}

/** 已结束、可写入 run-history.json 的运行结果。 */
export type RunHistoryStatus = 'success' | 'failed' | 'stopped';

/** Console 的规范日志流；system 用于 Runner 自身产生的摘要。 */
export type RunLogStream = 'stdout' | 'stderr' | 'system';

/** 单个 Session 日志条目。sequence 在 Session 内单调递增，裁剪后不重编号。 */
export interface RunLogEntry {
  sequence: number;
  stream: RunLogStream;
  text: string;
}

/** 轻量持久化运行摘要；只保存 metadata，不保存任何完整日志。 */
export interface RunHistoryEntry {
  historyId: string;
  sessionId: string;

  projectId: string;
  commandKey: string;
  commandType: RunSessionCommandType;
  commandId: string;
  displayName: string;

  cwd: string;
  status: RunHistoryStatus;

  startedAt: number;
  endedAt: number;
  durationMs: number;

  exitCode: number | null;
  errorMessage?: string;

  nodeRuntimeId?: string;
  nodeVersion?: string;
  nodePath?: string;
  packageManager?: string;
}

/***********************一级页快捷命令*********************/
/** 一级项目列表展示的快捷运行命令，type 用于区分同名 script 与 custom command。 */
export interface ProjectQuickCommand {
  type: 'script' | 'custom';
  /** script 名称或 CustomCommand.id */
  id: string;
}

export interface EditorConfig {
  id: string;
  name: string;
  path: string;
}

export interface TerminalConfig {
  id: string;
  name: string;
  path: string;
}

export interface ProjectFileEntry {
  id: string;
  name: string;
  path: string;
  isDirectory: boolean;
}

/** 代码模块：项目内识别出的子模块/子项目的快捷入口 */
export interface CodeModule {
  id: string;
  /** 显示名称（通常取目录名或 package.json 的 name） */
  name: string;
  /** 相对于项目根目录的路径 */
  relativePath: string;
  /** 识别到的语言/框架标记 */
  framework: CodeModuleFramework;
  /** 是否置顶 */
  pinned?: boolean;
}

/** 代码模块支持的框架/语言类型 */
export type CodeModuleFramework =
  | 'vue'
  | 'react'
  | 'node'
  | 'java'
  | 'go'
  | 'python'
  | 'dotnet'
  | 'unknown';

/** 子项目模块类型：由特征文件识别得出（前端/后端等），用于类型徽章展示 */
export type ProjectModuleKind =
  | 'frontend'
  | 'backend'
  | 'node'
  | 'go'
  | 'rust'
  | 'python'
  | 'dotnet'
  | 'static'
  | 'unknown';

export interface Project {
  id: string;
  name: string;
  path: string;
  /**
   * 项目类型。
   *
   * 'java' 是后来加的：所有相关判断都是 `type === 'node'` 的正向 guard，
   * 新值一律落进「非 node」分支，不会被注入 Node/包管理器环境。
   */
  type: 'node' | 'java' | 'other';
  /** Java 构建工具；仅 type === 'java' 时有值 */
  buildTool?: 'maven' | 'gradle';
  /** 是否存在 mvnw / gradlew，有则命令优先走 wrapper */
  hasWrapper?: boolean;
  gitRemoteUrl?: string;
  gitBranch?: string;
  gitConfigured?: boolean;
  nodeVersion?: string;
  /** 精确绑定的 Node Runtime；缺省时继续兼容 nodeVersion。 */
  nodeRuntimeId?: string;
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'cnpm';
  /** 包管理器来源：'project' 使用项目 Node 环境，'default' 借用默认 Node 环境的包管理器入口 */
  packageManagerSource?: 'project' | 'default';
  scripts?: string[];
  visibleScripts?: string[];
  customCommands?: CustomCommand[];
  /** 一级项目页最多展示 3 个快捷运行命令；旧数据缺省时由前端按默认顺序补齐。 */
  quickCommands?: ProjectQuickCommand[];
  projectFiles?: ProjectFileEntry[];
  memo?: string;
  pinned?: boolean;
  pinOrder?: number;
  sortOrder?: number;
  editorId?: string;
  description?: string;
  tags?: string[];
  groupId?: string;
  /** 父项目 id：为空表示一级项目（根）；非空表示嵌套子项目，用单向引用建模父子关系 */
  parentId?: string;
  /** 收藏：独立于 pinned（置顶排序），仅用于「收藏」筛选 */
  favorite?: boolean;
  /** 子项目模块类型：由特征文件识别得出，用于列表/卡片上的类型徽章 */
  moduleKind?: ProjectModuleKind;
  /** 子项目扫描时间戳：用于「重新扫描」提示 */
  subScannedAt?: number;
  /** 代码模块列表：扫描到的子模块快捷入口 */
  codeModules?: CodeModule[];
  /** 前端环境变量与 Vite 代理扫描缓存 */
  frontendEnvGroups?: FrontendEnvGroup[];
  /** 前端环境扫描时间 */
  frontendEnvScannedAt?: number;
  /**
   * 打开外部终端时是否注入项目 Node。
   * true / undefined：注入；false：只 cd，不解析/安装 Node。
   * 仅影响外部终端，不影响 Console 内命令运行。
   */
  terminalInjectNode?: boolean;
}

// ─── Project Group Types ────────────────────────────────────────────────────

export interface ProjectGroup {
  id: string;
  name: string;
  sortOrder?: number;
  collapsed?: boolean;
}

export type AiApiType = 'chat_completions' | 'responses';

export interface AiServiceConfig {
  apiType: AiApiType;
  baseUrl: string;
  apiKey: string;
  model: string;
}

/***********************AI 多渠道回退*********************/

/**
 * 回退模式，二选一：
 * - `single_channel` 单渠道多模型：1 套 baseUrl/apiKey + 最多 3 个模型，依次尝试
 * - `multi_channel`  多渠道多模型：最多 3 套各自独立的 baseUrl/apiKey/model，依次尝试
 *
 * 两种模式都是最多 3 次尝试，不叠加。
 */
export type AiFallbackMode = 'single_channel' | 'multi_channel';

/** 一个独立渠道（多渠道模式下的一个槽位） */
export interface AiChannelConfig extends AiServiceConfig {
  id: string;
  /** 关掉的槽位会被跳过，但配置保留 */
  enabled?: boolean;
}

/** 单渠道模式的配置：一套服务 + 多个候选模型 */
export interface AiSingleChannelConfig {
  service: AiServiceConfig;
  /** 候选模型，最多 3 个，按顺序回退 */
  models: string[];
}

/** 一次尝试：把两种模式展开后的统一形态 */
export interface AiAttempt extends AiServiceConfig {
  /** 展示用标签，回退发生时告诉用户实际用的是哪个 */
  label: string;
}

/** 回退可配置的最大槽位数（两种模式共用） */
export const MAX_AI_FALLBACK_SLOTS = 3;

export interface Settings {
  editorPath: string; // legacy fallback
  editors?: EditorConfig[];
  defaultEditorId?: string;
  defaultTerminal: string;
  customTerminals?: TerminalConfig[];
  /** Managed Node 运行时的正式存储位置。 */
  managedNodeRuntimeLocation?: ManagedRuntimeLocation;
  layoutState?: Record<string, number>;
  /** Project Explorer shared width in pixels. */
  workspaceExplorerWidth?: number;
  locale: 'zh' | 'en';
  themeMode: 'dark' | 'light' | 'auto';
  /** 全局界面密度与可读性档位；旧数据缺省或非法时回落为 standard。 */
  uiSize?: UiSize;
  /** 全局背景图片的本地文件路径 */
  backgroundImagePath?: string;
  /** 背景图片可见度，范围 0.1～1 */
  backgroundImageOpacity?: number;
  autoUpdate: boolean;
  trayEnabled?: boolean;
  closeAction?: 'ask' | 'tray' | 'exit';
  autoLaunch?: boolean;
  /** 应用内呼出快速搜索的快捷键 */
  quickSearchAppShortcut?: string;
  /** 是否注册系统级快捷键呼出快速搜索 */
  quickSearchGlobalShortcutEnabled?: boolean;
  /** 系统级呼出快速搜索的快捷键，仅桌面 Tauri 环境生效 */
  quickSearchGlobalShortcut?: string;
  // ─── 应用内常用操作快捷键 ────────────────────────────────────────────────
  // 说明：关闭弹窗（Esc）与逐级返回（Esc / Alt+←）是硬编码的导航键，不在此处配置。
  /** 聚焦项目搜索框 */
  focusSearchShortcut?: string;
  /** 新建项目 */
  newProjectShortcut?: string;
  /** 刷新项目列表 */
  refreshProjectsShortcut?: string;
  /** 左侧菜单快捷键，依次映射项目、Node、端口、提交日历、设置 */
  sidebarMenuShortcuts?: string[];
  /** @deprecated 旧版误用于工作区页签的字段，仅用于升级迁移 */
  workspaceTabShortcuts?: string[];
  // AI commit message generation
  gitAiEnabled?: boolean;
  gitAiPrimaryService?: AiServiceConfig;
  gitAiStream?: boolean;
  // ─── 多渠道回退 ────────────────────────────────────────────────────────
  /** 回退模式，二选一；缺省为单渠道多模型 */
  gitAiFallbackMode?: AiFallbackMode;
  /** 单渠道多模型模式的配置 */
  gitAiSingleChannel?: AiSingleChannelConfig;
  /** 多渠道多模型模式的配置，最多 MAX_AI_FALLBACK_SLOTS 个 */
  gitAiChannels?: AiChannelConfig[];
  // Legacy fields kept for migration/backup compatibility
  gitAiBaseUrl?: string;
  gitAiApiKey?: string;
  gitAiModel?: string;
  gitAiPromptTemplate?: string;
  /** pull 策略：ff-only 仅快进；default 使用 git pull 默认行为 */
  gitPullStrategy?: 'ff-only' | 'default';
  /** 危险操作（hard reset 等）是否二次确认，默认 true */
  gitConfirmDestructive?: boolean;
  // Usage weight sorting
  usageWeightEnabled?: boolean;
  // Sort mode: 'default' (manual drag), 'smart' (usage weight)
  sortMode?: 'default' | 'smart';
  // ─── Project 总控能力 ────────────────────────────────────────────────────
  /** 保存视图：把当前搜索 / 筛选 / 分组 / 标签 / 排序快速调出 */
  projectViewPresets?: ProjectViewPreset[];
  /** 启动组：一键运行一组项目命令 */
  workspaceProfiles?: WorkspaceProfile[];
}

/***********************工作区导航记忆*********************/

/**
 * 右侧工作区页签。
 *
 * 统一了原先 `stores/project.ts` 与 `ProjectWorkspace.vue` 里两份字面量完全
 * 相同的重复定义；`utils/workspaceTabFallback.ts` 也复用同一套取值。
 */
export type WorkspaceTab = 'console' | 'git' | 'editor' | 'files' | 'memo' | 'env';

/**
 * 工作区导航记忆。
 *
 * `leafTab` 与 `levelLeaf` **必须分开存**：钻取到最大深度时（drillStack 达到
 * MAX_PROJECT_DEPTH），一个有子项目的节点也只能被当作叶子选中，于是同一个
 * project id 既可能作为「层级」被记录选中的子项，又可能作为「叶子」被记录
 * 停留的页签。合成一个 Record 会让两种语义互相踩。
 */
export interface WorkspaceNavMemory {
  /** 叶子项目 id → 用户最后**手动**选择的页签 */
  leafTab: Record<string, WorkspaceTab>;
  /** 层级节点 id → 最后选中的叶子 id；null 表示选中的是层级自身（父项目入口卡） */
  levelLeaf: Record<string, string | null>;
}

/** 项目列表快捷筛选类型：基础 + 健康状态 */export type ProjectQuickFilter =
  | 'all'
  | 'pinned'
  | 'recent'
  | 'favorite'
  | 'running'
  | 'dirty'
  | 'unhealthy'
  | 'missing';

/** 保存视图：把当前过滤/排序状态打包命名后保存 */
export interface ProjectViewPreset {
  id: string;
  name: string;
  searchQuery: string;
  quickFilter: ProjectQuickFilter;
  /** null 表示全部分组 */
  groupId: string | null;
  tags: string[];
  sortMode: 'default' | 'smart';
  createdAt: string;
}

/** 启动组中的单条项：项目内脚本或自定义命令 */
export type WorkspaceProfileItemType = 'project' | 'custom';

export interface WorkspaceProfileItem {
  type: WorkspaceProfileItemType;
  projectId: string;
  /**
   * 当 type='project' 时是脚本名（如 'dev' / 'build'）
   * 当 type='custom' 时是 CustomCommand.id
   */
  nameOrCommandId: string;
  /** 可选，显示名（避免脚本被删后无法识别） */
  label?: string;
}

/** 启动组：一组命令可一键启动/停止 */
export interface WorkspaceProfile {
  id: string;
  name: string;
  items: WorkspaceProfileItem[];
  icon?: string;
  createdAt: string;
}

/** 项目健康问题 */
export interface ProjectHealthIssue {
  code: 'path_missing' | 'not_git' | 'git_dirty' | 'pm_unresolved' | 'node_unresolved';
  level: 'warn' | 'error';
  message: string;
}

/** 项目健康快照：缓存最近一次扫描结果 */
export interface ProjectHealthSnapshot {
  projectId: string;
  running: boolean;
  hasGit: boolean;
  gitDirty: boolean;
  pmResolved: boolean;
  pathExists: boolean;
  issues: ProjectHealthIssue[];
  updatedAt: number;
}

export type NodeRuntimeSource = 'managed' | 'nvm' | 'system' | 'custom';

export type NodeRuntimeStatus = 'available' | 'broken' | 'installing' | 'unavailable';

export type ManagedRuntimeLocationMode = 'app-data' | 'custom' | 'portable';

export interface ManagedRuntimeLocation {
  mode: ManagedRuntimeLocationMode;
  customPath?: string;
}

export interface ManagedRuntimeLocationInfo extends ManagedRuntimeLocation {
  rootPath: string;
  writable: boolean;
  portableAvailable: boolean;
  installedCount: number;
  sizeBytes: number;
  /** 目录大小统计状态；计算期间由前端保持 loading 状态。 */
  sizeStatus?: 'calculating' | 'ready' | 'error';
  warnings?: string[];
}

export interface ManagedRuntimeSizeInfo {
  sizeBytes: number;
  sizeStatus: 'calculating' | 'ready' | 'error';
  warnings?: string[];
}

export interface NodeVersion {
  /** 稳定 Runtime 身份；旧数据缺省时由 registry 推导。 */
  runtimeId?: string;
  /** 来源管理器的根目录（例如 NVM_HOME），仅用于展示与快捷操作。 */
  runtimeRoot?: string;
  /** 解析 junction/reparse point 后的真实 Runtime 根目录。 */
  canonicalPath?: string;
  version: string;
  path: string;
  source: NodeRuntimeSource;
  status?: NodeRuntimeStatus;
  isDefault?: boolean;
}

export type CanonicalNodeRuntimeSource = 'managed' | 'nvm' | 'custom' | 'external';

export interface NodeRuntimeAlias {
  source: NodeRuntimeSource | 'external';
  path: string;
  runtimeId?: string;
}

/** 一个真实 physical Runtime；junction/symlink 只保留为 aliases。 */
export interface CanonicalNodeRuntime {
  canonicalId: string;
  version: string;
  preferredSource: CanonicalNodeRuntimeSource;
  runtimePath: string;
  executablePath: string;
  /** 同一 physical Runtime 的所有 Registry 变体，用于精确选择 effective Runtime。 */
  variants: NodeVersion[];
  aliases: NodeRuntimeAlias[];
  runtime: NodeVersion;
  isSystemCurrent: boolean;
  isProjectManagerDefault: boolean;
}

/** Runtime Center 主列表的一行；一个精确版本只对应一个 entry。 */
export interface NodeVersionEntry {
  key: string;
  version: string;
  runtimes: CanonicalNodeRuntime[];
  effectiveRuntime: NodeVersion;
  isSystemCurrent: boolean;
  isProjectManagerDefault: boolean;
}

export type SystemNodePathScope = 'user' | 'machine' | 'nvm' | 'unknown';

export interface SystemNodeCandidate {
  path: string;
  version?: string;
  canonicalPath?: string;
}

/** Real Node resolution from the current OS environment, never persisted as the source of truth. */
export interface SystemNodeState {
  available: boolean;
  version?: string;
  nodePath?: string;
  runtimeId?: string;
  source?: NodeRuntimeSource | 'external' | 'unknown';
  candidates: SystemNodeCandidate[];
  pathScope?: SystemNodePathScope;
  nvmSymlink?: string;
  nvmTargetPath?: string;
  /** 第一条 where 结果解析后的真实 executable。 */
  canonicalNodePath?: string;
}

export interface SystemNodeSwitchOptions {
  elevated?: boolean;
  /** @deprecated PATH 优先级由 elevated Controller operation 自动处理。 */
  repairPathPriority?: boolean;
}

export type SystemNodeSwitchStatus =
  | 'switched'
  | 'already-active'
  | 'elevation-required'
  | 'path-conflict'
  | 'cancelled'
  | 'failed';

export interface SystemNodeSwitchResult {
  success: boolean;
  status: SystemNodeSwitchStatus;
  previous?: SystemNodeState;
  current?: SystemNodeState;
  conflictingPath?: string;
  operation?: 'controller' | 'user-path' | 'machine-path';
  errorCode?: string;
  message?: string;
}

export interface NodeInstallProgress {
  operationId: string;
  version: string;
  phase: 'preparing' | 'resolving' | 'downloading' | 'verifying' | 'extracting' | 'finalizing' | 'validating' | 'cleanup' | 'complete' | string;
  downloadedBytes?: number;
  totalBytes?: number;
  percent?: number;
  warning?: string;
}

export interface NodeReleaseInfo {
  version: string;
  date: string;
  lts?: string | boolean;
}

export interface AppDefaultNode {
  /** 稳定 Runtime 身份；旧数据缺省时按 source/path/version 迁移。 */
  runtimeId?: string;
  source: NodeRuntimeSource;
  version: string;
  path: string;
}

// ─── Usage Weight Types ──────────────────────────────────────────────────────

export interface UsageEvent {
  date: string;    // 'YYYY-MM-DD'
  count: number;
}

export interface ProjectUsage {
  projectId: string;
  events: UsageEvent[];
  addedAt: string; // 'YYYY-MM-DD'
}

export interface UsageData {
  records: Record<string, ProjectUsage>;
  lastWeeklyNormalization: string; // 'YYYY-MM-DD'
}

// ─── Git Types ───────────────────────────────────────────────────────────────

export interface GitFileStatus {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted' | 'copied';
  staged: boolean;
  old_path?: string;
}

export interface GitStatusResult {
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  untracked: GitFileStatus[];
  conflicted: GitFileStatus[];
}

export interface GitBranch {
  name: string;
  is_remote: boolean;
  is_current: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
}

export interface GitCommit {
  hash: string;
  short_hash: string;
  author: string;
  email: string;
  committer: string;
  date: string;
  message: string;
  parents: string[];
  refs: string[];
  graph_prefix?: string;
}

export interface GitOwnCommit {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  date: string;
  message: string;
}

export interface GitAuthorIdentity {
  name?: string;
  email?: string;
}

export interface GitOwnCommitResult {
  identity: GitAuthorIdentity;
  commits: GitOwnCommit[];
}

export interface GitRemote {
  name: string;
  url: string;
  remote_type: string;
}

/** 仓库进行中的 Git 状态机（merge/rebase 等） */
export type GitOperationState = 'merge' | 'rebase' | 'cherry-pick' | 'revert';

/** 结构化 Git 操作结果（写操作可返回，便于展示原始输出） */
export interface GitOperationResult {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  message_zh?: string;
}

export interface GitStashEntry {
  index: number;
  message: string;
  date: string;
}

export interface GitTag {
  name: string;
  hash: string;
}

export type GitResetMode = 'soft' | 'mixed' | 'hard';
export type GitPullStrategy = 'ff-only' | 'default';
export type GitIgnoreKind = 'file' | 'filename' | 'extension' | 'directory';
export type GitHunkMode = 'stage' | 'unstage' | 'discard';

export interface GitImageSide {
  mime: string;
  base64: string;
  size: number;
  width?: number;
  height?: number;
}

export interface GitImageDiffPayload {
  kind: 'image';
  before?: GitImageSide;
  after?: GitImageSide;
}

export interface GitBinaryDiffMeta {
  kind: 'binary';
  beforeSize?: number;
  afterSize?: number;
  beforeExists: boolean;
  afterExists: boolean;
}

export interface GitSummary {
  branch: string;
  is_detached: boolean;
  ahead: number;
  behind: number;
  has_remote: boolean;
  remote_name?: string;
  /** 跟踪分支，如 origin/main */
  upstream?: string;
  has_conflicts: boolean;
  conflicted_count: number;
  staged_count: number;
  unstaged_count: number;
  untracked_count: number;
  /** 进行中的高级操作；无则为 null/undefined */
  operation_state?: GitOperationState | null;
}

export interface GitCommitFile {
  path: string;
  status: string; // 'A' | 'M' | 'D' | 'R' | 'C'
  old_path?: string;
}
