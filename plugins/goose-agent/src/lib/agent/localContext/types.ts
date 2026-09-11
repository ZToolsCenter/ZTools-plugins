/**
 * 全局 / 项目本地上下文发现层类型。
 * 命名对齐 agentskills.io 与 Cursor/Claude 的 mcpServers 约定。
 */

export type ContextScope = "global" | "project" | "builtin";

/** 发现到的 Skill（agentskills.io：SKILL.md + name/description frontmatter） */
export type DiscoveredSkill = {
  name: string;
  description: string;
  path: string;
  content: string;
  scope: ContextScope;
};

/** MCP 传输类型（只读发现，不启动进程） */
export type McpTransport = "stdio" | "http" | "sse" | "unknown";

/** 发现到的 MCP 服务条目 */
export type DiscoveredMcpServer = {
  name: string;
  scope: ContextScope;
  sourcePath: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  /** 原始配置条目，便于上层调试 */
  raw?: unknown;
};

/** AGENTS.md 提示词分层（全局 + 项目） */
export type PromptLayers = {
  /** ~/AGENTS.md */
  globalAgentsMd: string | null;
  /** <workspaceRoot>/AGENTS.md */
  projectAgentsMd: string | null;
};

/** 路径解析输入（不直接读 fs，由调用方提供 home / workspace） */
export type LocalContextPathInput = {
  homeDir: string;
  workspaceRoot?: string | null;
};

/** 带 scope 的路径描述 */
export type ScopedPath = {
  scope: ContextScope;
  path: string;
  /** 路径用途标签，便于日志 */
  kind: "agentsMd" | "skillsRoot" | "mcpConfig";
};
