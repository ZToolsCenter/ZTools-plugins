// ZTools ccToggle - mcp/types.ts
// MCP 模块共享类型与适配器接口

export interface StdioEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface SseEntry {
  url: string;
  headers?: Record<string, string>;
}

export interface HttpEntry {
  url: string;
  headers?: Record<string, string>;
}

export interface ConfigEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  authType?: string;
  apiKey?: string;
}

export interface McpServerData {
  stdio?: StdioEntry | null;
  sse?: SseEntry | null;
  http?: HttpEntry | null;
}

export interface McpServer {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  stdio: StdioEntry | null;
  sse: SseEntry | null;
  http: HttpEntry | null;
  apps: string[];
}

export interface AppMapping {
  disabled: string[];
  [app: string]: string[];
}

export interface ConfigsMap {
  [app: string]: Record<string, ConfigEntry>;
}

export interface TransportFields {
  stdio?: StdioEntry;
  sse?: { url: string; headers: Record<string, string>; authType: string; apiKey: string };
  http?: { url: string; headers: Record<string, string>; authType: string; apiKey: string };
}

/** 单个 agent 的 MCP 配置适配器：封装读/写/路径差异 */
export interface AgentMcpAdapter {
  /** agent 标识，如 "claude"、"codex" */
  id: string;
  /** 配置文件名（用于前端展示/日志） */
  label: string;
  getConfigPath(): string;
  /** 读取该 agent 配置中的 MCP server 列表 */
  readServers(): Record<string, ConfigEntry>;
  /** 写入/删除（entryOrNull 为 null 时删除）单个 server */
  writeServer(name: string, entryOrNull: ConfigEntry | null): void;
}
