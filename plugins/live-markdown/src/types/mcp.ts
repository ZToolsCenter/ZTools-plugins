export type McpTransport = "builtin" | "streamable-http";
export type McpServerStatus = "disconnected" | "connecting" | "connected" | "error";

export interface McpServerInput {
  id?: string;
  name: string;
  transport: "streamable-http";
  url: string;
  token?: string;
  enabled?: boolean;
}

export interface McpServerSummary {
  id: string;
  name: string;
  transport: McpTransport;
  url: string;
  enabled: boolean;
  builtIn: boolean;
  hasToken: boolean;
  status: McpServerStatus;
  error?: string;
}

export interface McpToolSummary {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type McpTool = McpToolSummary;
export interface McpServerConfig {
  id: string;
  name: string;
  endpoint: string;
  protocol: McpTransport;
  enabled: boolean;
  tools: McpTool[];
}

export interface McpConnectionSummary {
  serverId: string;
  status: McpServerStatus;
  protocolVersion?: string;
  toolCount: number;
  error?: string;
}

export interface McpToolResult {
  serverId: string;
  toolName: string;
  content: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError: boolean;
}

export interface McpBridge {
  listServers(): Promise<McpServerSummary[]>;
  upsertServer(input: McpServerInput): Promise<McpServerSummary>;
  removeServer(serverId: string): Promise<void>;
  setEnabled(serverId: string, enabled: boolean): Promise<McpServerSummary>;
  connect(serverId: string): Promise<McpConnectionSummary>;
  disconnect(serverId: string): Promise<void>;
  listTools(serverId: string): Promise<McpToolSummary[]>;
  callTool(serverId: string, toolName: string, args: Record<string, unknown>, requestId?: string): Promise<McpToolResult>;
  cancel(requestId: string): Promise<void>;
  dispose(): void;
}
