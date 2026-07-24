export interface CustomCommand {
  id: string;
  name: string;
  command: string;
  builtinId?: 'install_dependencies';
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

export interface Project {
  id: string;
  name: string;
  path: string;
  type: 'node' | 'other';
  gitRemoteUrl?: string;
  gitBranch?: string;
  gitConfigured?: boolean;
  nodeVersion?: string;
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'cnpm';
  /** 包管理器来源：'project' 使用项目 Node 环境，'default' 借用默认 Node 环境的包管理器入口 */
  packageManagerSource?: 'project' | 'default';
  scripts?: string[];
  visibleScripts?: string[];
  customCommands?: CustomCommand[];
  projectFiles?: ProjectFileEntry[];
  memo?: string;
  pinned?: boolean;
  pinOrder?: number;
  sortOrder?: number;
  editorId?: string;
}

export type AiApiType = 'chat_completions' | 'responses';

export interface AiServiceConfig {
  apiType: AiApiType;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface Settings {
  editorPath: string; // legacy fallback
  editors?: EditorConfig[];
  defaultEditorId?: string;
  defaultTerminal: string;
  customTerminals?: TerminalConfig[];
  layoutState?: Record<string, number>;
  locale: 'zh' | 'en';
  themeMode: 'dark' | 'light' | 'auto';
  autoUpdate: boolean;
  trayEnabled?: boolean;
  closeAction?: 'ask' | 'tray' | 'exit';
  autoLaunch?: boolean;
  // AI commit message generation
  gitAiEnabled?: boolean;
  gitAiPrimaryService?: AiServiceConfig;
  gitAiStream?: boolean;
  // Legacy fields kept for migration/backup compatibility
  gitAiBaseUrl?: string;
  gitAiApiKey?: string;
  gitAiModel?: string;
  gitAiPromptTemplate?: string;
  // Usage weight sorting
  usageWeightEnabled?: boolean;
  // Sort mode: 'default' (manual drag), 'smart' (usage weight)
  sortMode?: 'default' | 'smart';
}

export interface NodeVersion {
  version: string;
  path: string;
  source: 'nvm' | 'custom' | 'system';
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

export interface GitRemote {
  name: string;
  url: string;
  remote_type: string;
}

export interface GitSummary {
  branch: string;
  is_detached: boolean;
  ahead: number;
  behind: number;
  has_remote: boolean;
  remote_name?: string;
}

export interface GitCommitFile {
  path: string;
  status: string; // 'A' | 'M' | 'D' | 'R' | 'C'
  old_path?: string;
}
