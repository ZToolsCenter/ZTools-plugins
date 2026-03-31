export interface CustomCommand {
  id: string;
  name: string;
  command: string;
}

export interface EditorConfig {
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
  nodeVersion?: string;
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'cnpm';
  scripts?: string[];
  visibleScripts?: string[];
  customCommands?: CustomCommand[];
  projectFiles?: ProjectFileEntry[];
  memo?: string;
  pinned?: boolean;
  pinOrder?: number;
  editorId?: string;
}

export interface Settings {
  editorPath: string; // legacy fallback
  editors?: EditorConfig[];
  defaultTerminal: string;
  customTerminals?: { id: string; name: string }[];
  locale: 'zh' | 'en';
  themeMode: 'dark' | 'light' | 'auto';
  autoUpdate: boolean;
  // AI commit message generation
  gitAiEnabled?: boolean;
  gitAiBaseUrl?: string;
  gitAiApiKey?: string;
  gitAiModel?: string;
  gitAiPromptTemplate?: string;
}

export interface NodeVersion {
  version: string;
  path: string;
  source: 'nvm' | 'custom' | 'system';
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
