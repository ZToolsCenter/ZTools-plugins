import type {
  McpBridge as McpBridgeApi,
  McpConnectionSummary,
  McpServerInput,
  McpServerSummary,
  McpToolResult,
  McpToolSummary
} from "../../types/mcp";

/** Thin renderer adapter. Real protocol work stays in the preload process. */
export class McpBridge {
  constructor(private readonly api?: McpBridgeApi) {}

  listServers(): Promise<McpServerSummary[]> {
    return this.requireApi().listServers();
  }

  upsertServer(input: McpServerInput): Promise<McpServerSummary> {
    return this.requireApi().upsertServer(input);
  }

  removeServer(serverId: string): Promise<void> {
    return this.requireApi().removeServer(serverId);
  }

  setEnabled(serverId: string, enabled: boolean): Promise<McpServerSummary> {
    return this.requireApi().setEnabled(serverId, enabled);
  }

  connect(serverId: string): Promise<McpConnectionSummary> {
    return this.requireApi().connect(serverId);
  }

  disconnect(serverId: string): Promise<void> {
    return this.requireApi().disconnect(serverId);
  }

  listTools(serverId: string): Promise<McpToolSummary[]> {
    return this.requireApi().listTools(serverId);
  }

  callTool(serverId: string, toolName: string, args: Record<string, unknown>, requestId?: string): Promise<McpToolResult> {
    return this.requireApi().callTool(serverId, toolName, args, requestId);
  }

  cancel(requestId: string): Promise<void> {
    return this.requireApi().cancel(requestId);
  }

  dispose(): void {
    this.api?.dispose();
  }

  private requireApi(): McpBridgeApi {
    if (!this.api) throw new Error("MCP bridge is unavailable; open this plugin in a supported host");
    return this.api;
  }
}
