/// <reference types="vite/client" />

/** 目录条目（gooseFs.readDir 返回） */
interface GooseFsDirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  path: string;
}

/** 读文件 + 状态结果 */
interface GooseFsReadStatResult {
  ok: boolean;
  error?: string | null;
  content?: string | null;
}

/**
 * 本机 FS 桥（preload 注入）。
 * 文件 tools / 工作区挂载依赖此面；web 预览由 mock 降级。
 */
interface GooseFs {
  readDir: (dir: string) => GooseFsDirEntry[];
  readDirAsync?: (dir: string) => Promise<GooseFsDirEntry[]>;
  readFile: (path: string) => string | null;
  readFileAsync?: (path: string) => Promise<string | null>;
  readFileBase64?: (path: string) => string | null;
  readFileStat?: (path: string) => GooseFsReadStatResult;
  readFileStatAsync?: (path: string) => Promise<GooseFsReadStatResult>;
  writeFile: (path: string, content: string, encoding?: string) => boolean;
  writeFileAsync?: (
    path: string,
    content: string,
    encoding?: string,
  ) => Promise<boolean>;
  exists: (path: string) => boolean;
  existsAsync?: (path: string) => Promise<boolean>;
  realpathAsync?: (path: string) => Promise<string | null>;
  mkdir: (dir: string) => boolean | Promise<boolean>;
  deleteFile: (path: string) => boolean | Promise<boolean>;
  deleteDir: (path: string) => boolean | Promise<boolean>;
  rename: (oldPath: string, newPath: string) => boolean | Promise<boolean>;
  /** 弹出系统选目录对话框；取消或不可用时返回 null */
  selectDirectory?: () => Promise<string | null>;
  /** 本机家目录；web mock 可省略或返回 null */
  getHomedir?: () => string;
  /** 用系统文件管理器打开路径（目录 / 文件） */
  openInFileManager?: (targetPath: string) => boolean | Promise<boolean>;
  /**
   * 本机 shell（ADR 0023）；权限门控在 Agent 层。
   * 无 preload / web mock 时可不存在，执行层可回落 child_process。
   */
  runCommand?: (opts: {
    command: string;
    cwd?: string;
    timeoutMs?: number;
  }) => Promise<{
    ok?: boolean;
    exitCode?: number | null;
    stdout?: string;
    stderr?: string;
    timedOut?: boolean;
    error?: string;
  }>;
}

interface GooseAgentBridge {
  storageGet: (key: string) => unknown;
  storageSet: (key: string, value: unknown) => boolean;
  storageRemove: (key: string) => boolean;
  copyText: (text: string) => void;
  showNotification: (text: string) => void;
  hideWindow: () => void;
  showWindow: () => void;
  outPlugin?: () => void;
  /** clamp → setExpendHeight → 持久化；返回实际高度（仅 uTools 宿主） */
  setWindowHeight?: (height: number) => number;
  /** 当前生效窗口高度（仅 uTools 宿主） */
  getWindowHeight?: () => number;
}

/** AI 上下文文件条目（skills / MCP 配置） */
interface GooseAiContextFile {
  path: string;
  content: string;
}

/**
 * AI 上下文桥（preload 注入）：固定路径读全局/项目 AGENTS、skills、MCP。
 * 浏览器无 preload 时可不存在，前端自行降级。
 */
interface GooseAiContext {
  /** 读 ~/AGENTS.md */
  readGlobalPrompt: () => string | null;
  /** 写 ~/AGENTS.md */
  writeGlobalPrompt: (content: string) => boolean;
  /** 全局 skills 根：~/.agents/skills（只读路径） */
  getGlobalSkillsRoot?: () => string;
  /** 全局 skills：~/.agents/skills 下各层 SKILL.md */
  listLocalSkills: () => GooseAiContextFile[];
  /** 项目 skills：<workspaceRoot>/.agents/skills（须绝对且存在） */
  listProjectSkills: (workspaceRoot: string) => GooseAiContextFile[];
  /** 读 <workspaceRoot>/AGENTS.md */
  readProjectPrompt: (workspaceRoot: string) => string | null;
  /** 写 <workspaceRoot>/AGENTS.md */
  writeProjectPrompt: (workspaceRoot: string, content: string) => boolean;
  /** 全局 MCP 单源只读：~/.agents/mcp.json（不 spawn；文件不存在则 []） */
  listGlobalMcpConfigs: () => GooseAiContextFile[];
  /** 项目 MCP 单源只读：<workspaceRoot>/.agents/mcp.json（文件不存在则 []） */
  listProjectMcpConfigs: (workspaceRoot: string) => GooseAiContextFile[];
}

interface Window {
  gooseAgent?: GooseAgentBridge;
  gooseFs?: GooseFs;
  gooseAiContext?: GooseAiContext;
  utools?: Record<string, unknown>;
}
