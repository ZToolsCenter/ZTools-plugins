export type ThemeName =
  | "github"
  | "night"
  | "newsprint"
  | "pixyll"
  | "whitey"
  | "gothic";

export type SidebarTab = "files" | "outline" | "search";

export type FileViewMode = "tree" | "list";

export type SortField = "name" | "mtime";

export type SortDirection = "asc" | "desc";

export type AlertKind = "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION";

export type TableAlign = "left" | "center" | "right" | null;

export type BlockType =
  | "frontmatter"
  | "heading"
  | "paragraph"
  | "blockquote"
  | "alert"
  | "list"
  | "code"
  | "math"
  | "diagram"
  | "table"
  | "hr"
  | "toc"
  | "footnote_def";

export interface MarkdownListItem {
  id: string;
  text: string;
  checked?: boolean;
  indent: number;
  marker: string;
}

export interface MarkdownBlock {
  id: string;
  type: BlockType;
  raw: string;
  startLine: number;
  endLine: number;
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  headingStyle?: "atx" | "setext";
  text?: string;
  slug?: string;
  alertKind?: AlertKind;
  listType?: "ul" | "ol" | "task";
  listStart?: number;
  items?: MarkdownListItem[];
  language?: string;
  code?: string;
  mathTex?: string;
  diagramType?: "mermaid" | "flow" | "sequence";
  headers?: string[];
  alignments?: TableAlign[];
  rows?: string[][];
  footnoteId?: string;
  footnoteContent?: string;
  yamlMeta?: Record<string, string>;
}

export interface OutlineItem {
  id: string;
  blockId: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  slug: string;
  line: number;
}

export interface WordCountStats {
  words: number;
  charsNoSpaces: number;
  charsWithSpaces: number;
  cjkChars: number;
  lines: number;
  paragraphs: number;
  readingMinutes: number;
}

export interface WorkspaceFileNode {
  type: "file";
  name: string;
  path: string;
  relativePath: string;
  ext: string;
  title: string;
  excerpt: string;
  size: number;
  mtimeMs: number;
  birthtimeMs: number;
}

export interface WorkspaceDirectoryNode {
  type: "directory";
  name: string;
  path: string;
  relativePath: string;
  children: Array<WorkspaceDirectoryNode | WorkspaceFileNode>;
  childrenLoaded?: boolean;
}

export type WorkspaceTreeNode = WorkspaceDirectoryNode | WorkspaceFileNode;

export interface WorkspaceScanResult {
  rootDir: string;
  rootName: string;
  tree: WorkspaceDirectoryNode;
  files: WorkspaceFileNode[];
  isShallow?: boolean;
}

export interface WorkspaceSearchMatch {
  lineNumber: number;
  lineText: string;
  matchStart: number;
  matchEnd: number;
  matchText: string;
}

export interface WorkspaceSearchFileResult {
  path: string;
  name: string;
  relativePath: string;
  matches: WorkspaceSearchMatch[];
}

export interface WorkspaceSearchResponse {
  totalMatches: number;
  fileCount: number;
  results: WorkspaceSearchFileResult[];
}

export interface LoadedDocument {
  /** Stable editor/history identity; distinct for pathless drafts. */
  documentId?: string;
  /** Recovered drafts without a provable baseline must be saved as a new file. */
  recoveryNeedsSaveAs?: boolean;
  recoveryBaselineKnown?: boolean;
  recoveryBaselineContent?: string;
  recoveryBaselinePath?: string | null;
  path: string | null;
  name: string;
  dir: string;
  content: string;
  isDirty: boolean;
  mtimeMs: number;
}

export type PreferencesTab =
  | "editor"
  | "markdown"
  | "image"
  | "appearance"
  | "webdav";

export type WebdavSyncDirection = "bidirectional" | "push" | "pull";

export interface WebdavConfig {
  enabled: boolean;
  serverUrl: string;
  username: string;
  password: string;
  remotePath: string;
  autoSyncOnSave: boolean;
  syncDirection: WebdavSyncDirection;
}

export interface WebdavRemoteFile {
  name: string;
  href: string;
  size: number;
  lastModified: string;
  mtimeMs: number;
  hasValidMtime?: boolean;
  etag: string;
}

export interface WebdavTestResult {
  ok: boolean;
  status: number;
  message: string;
  serverUrl: string;
  remotePath: string;
  fileCount: number;
  files: WebdavRemoteFile[];
}

export interface WebdavListResult {
  ok: boolean;
  status: number;
  message: string;
  remotePath: string;
  files: WebdavRemoteFile[];
  syncedAt: number;
}

/** 同名冲突原因：写入会覆盖本设备未同步过的内容时，同步引擎拒绝写入。 */
export type WebdavConflictReason =
  | "bound-elsewhere"
  | "remote-changed"
  | "unknown-remote"
  | "local-modified"
  | "local-unknown";

export interface WebdavConflict {
  name: string;
  direction: "push" | "pull";
  reason: WebdavConflictReason;
  message: string;
}

export interface WebdavPushResult {
  ok: boolean;
  name: string;
  remoteUrl?: string;
  status?: number;
  size?: number;
  syncedAt: number;
  error?: string;
  conflict?: boolean;
  reason?: WebdavConflictReason;
}

export interface WebdavPullResult {
  ok: boolean;
  name: string;
  /** 冲突被拦截时不返回内容。 */
  content?: string;
  path: string | null;
  dir: string;
  size?: number;
  mtimeMs?: number;
  syncedAt: number;
  error?: string;
  conflict?: boolean;
  reason?: WebdavConflictReason;
}

export interface WebdavSyncResult {
  ok: boolean;
  direction: WebdavSyncDirection;
  uploaded: string[];
  downloaded: string[];
  downloadedPaths?: string[];
  skipped: string[];
  /** 因同名冲突被拦截、未写入任何一侧的文件。 */
  conflicts?: WebdavConflict[];
  remoteFiles: WebdavRemoteFile[];
  syncedAt: number;
  message: string;
  error?: string;
}

export interface TyporaPreferences {
  theme: ThemeName;
  codeTheme?: import("../core/codeThemes").CodeTheme;
  fontSize: number;
  lineWidth: "default" | "wide" | "full";
  autoSave: boolean;
  showLineNumbersInCode: boolean;
  wrapCodeBlocks: boolean;
  enableInlineMath: boolean;
  enableSubscriptSuperscript: boolean;
  enableHighlight: boolean;
  enableDiagrams: boolean;
  strictMode: boolean;
  imageRootPathMode: "assets" | "per-doc-assets";
  copyImagesAsAbsolute?: boolean;
  defaultIndentSize: 2 | 4;
  spellcheck: boolean;
  editorEngine?: "cm6" | "block";
  enableAiCopilot?: boolean;
  aiDefaultModel?: string;
}

export type {
  AiQuickAction,
  AiSkill,
  McpTool,
  McpServerConfig,
  AiProviderId,
  AgentPermissionLevel,
  HarnessGateConfig,
  AgentRolePreset,
  AgentOrchestrationConfig,
  HostAdapter
} from "./aiOrchestration";
import type { LocalAiBridge } from "./localAi";
import type { McpBridge } from "./mcp";

export type InlineFormatAction =
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "highlight"
  | "code"
  | "math"
  | "sub"
  | "sup"
  | "link"
  | "image"
  | "clear";

export interface TyporaBridgeApi {
  localAi?: LocalAiBridge;
  mcp?: McpBridge;
  dispose?: () => boolean;
  getDefaultNotesDir: () => string;
  loadPersistedState: () => Record<string, unknown> | null;
  savePersistedState: (patch: Record<string, unknown>) => Record<string, unknown>;
  selectOpenFile: (options?: Record<string, unknown>) => string | null;
  selectOpenFolder: (options?: Record<string, unknown>) => string | null;
  selectOpenFolders?: (options?: Record<string, unknown>) => string[];
  selectSaveFile: (options?: Record<string, unknown>) => string | null;
  selectImageFile: (options?: Record<string, unknown>) => string | null;
  copyTextToClipboard: (text: string) => boolean;
  openExternalUrl: (url: string) => boolean;
  revealInFinder: (targetPath: string) => boolean;
  isDirectory?: (targetPath: string) => boolean;
  setWorkspaceRoots?: (roots: string[]) => void;
  subscribePluginEnter: (
    listener: (action: { code?: string; type?: string; payload?: unknown }) => void
  ) => () => void;
  readDocument: (filePath: string) => {
    path: string;
    name: string;
    dir: string;
    ext: string;
    content: string;
    title: string;
    excerpt: string;
    size: number;
    mtimeMs: number;
    birthtimeMs: number;
  };
  writeDocument: (filePath: string, content: string) => {
    path: string;
    name: string;
    dir: string;
    content: string;
    mtimeMs: number;
    size: number;
  };
  writeDocumentAsync?: (
    filePath: string,
    content: string,
    options: { expectedContent: string }
  ) => Promise<{
    path: string;
    name: string;
    dir: string;
    content: string;
    mtimeMs: number;
    size: number;
  }>;
  createDocument: (
    parentDir: string,
    fileName?: string,
    initialContent?: string
  ) => {
    path: string;
    name: string;
    dir: string;
    content: string;
    mtimeMs: number;
  };
  createFolder: (
    parentDir: string,
    folderName?: string
  ) => { path: string; name: string; type: "directory" };
  renameEntry: (
    oldPath: string,
    newName: string
  ) => { oldPath: string; newPath: string; name: string; isDirectory: boolean };
  duplicateDocument: (filePath: string) => {
    path: string;
    name: string;
    dir: string;
    content: string;
    mtimeMs: number;
  };
  deleteEntry: (targetPath: string) => { deleted: boolean; path: string };
  listDirectoryChildren?: (
    dirPath: string,
    rootDir?: string
  ) => {
    dirPath: string;
    children: Array<WorkspaceDirectoryNode | WorkspaceFileNode>;
    files: WorkspaceFileNode[];
  };
  scanWorkspace: (
    rootDir: string,
    options?: { maxDepth?: number; maxFiles?: number; shallow?: boolean }
  ) => WorkspaceScanResult;
  searchInWorkspace: (
    rootDir: string,
    query: string,
    options?: { caseSensitive?: boolean; wholeWord?: boolean; isRegex?: boolean }
  ) => WorkspaceSearchResponse;
  copyImageToAssets: (
    docPath: string,
    sourceImageInput: string,
    options?: { usePerDocAssets?: boolean; fileName?: string }
  ) => {
    savedAbsolutePath: string;
    relativeMarkdownPath: string;
    fileUrl: string;
  };
  resolveImageUrl: (
    docPath: string | null,
    rawSrc: string,
    rootUrlFromYaml?: string
  ) => string;
  buildStandaloneHtml: (options: {
    title?: string;
    htmlBody?: string;
    themeName?: string;
    themeCss?: string;
    baseCss?: string;
    includeStyles?: boolean;
  }) => string;
  exportHtmlFile: (
    targetPath: string,
    options: {
      title?: string;
      htmlBody?: string;
      themeName?: string;
      themeCss?: string;
      baseCss?: string;
      includeStyles?: boolean;
    }
  ) => { path: string; size: number };
  testWebdavConnection?: (config: WebdavConfig) => Promise<WebdavTestResult>;
  listWebdavFiles?: (config: WebdavConfig) => Promise<WebdavListResult>;
  pushWebdavDocument?: (
    config: WebdavConfig,
    docName: string,
    content: string,
    options?: { localPath?: string | null }
  ) => Promise<WebdavPushResult>;
  pullWebdavDocument?: (
    config: WebdavConfig,
    remoteFileName: string,
    localTargetDir?: string | null
  ) => Promise<WebdavPullResult>;
  deleteWebdavDocument?: (
    config: WebdavConfig,
    remoteFileName: string
  ) => Promise<{ ok: boolean; name: string; status: number; error?: string }>;
  syncWorkspaceWithWebdav?: (
    config: WebdavConfig,
    options?: {
      localDir?: string | null;
      activeDoc?: {
        name: string;
        content: string;
        path?: string | null;
        mtimeMs?: number;
      } | null;
      direction?: WebdavSyncDirection;
    }
  ) => Promise<WebdavSyncResult>;
}

declare global {
  interface Window {
    typoraBridge?: TyporaBridgeApi;
    services?: TyporaBridgeApi;
    ztools?: Record<string, unknown>;
    atools?: Record<string, unknown>;
    __TAURI__?: Record<string, unknown>;
  }
}
