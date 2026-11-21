export type AiQuickAction = "continue" | "polish" | "expand" | "summarize" | "translate" | "proofread" | "diagram";

export interface AiSkill {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: "writing" | "academic" | "diagram" | "coding" | "summary";
  systemPrompt: string;
  userPromptTemplate: string;
}

export type { McpTool, McpServerConfig } from "./mcp";

export type AiProviderId = "ztools" | "atools" | "local";
export type AgentPermissionLevel = "read-only" | "confirm" | "auto";

export interface HarnessGateConfig {
  syntaxHealing: boolean;
  panguSpacing: boolean;
  stripChitchat: boolean;
  securityLeakScan: boolean;
}

export interface AgentRolePreset {
  id: string;
  name: string;
  description: string;
  icon: string;
  systemPrompt: string;
}

export interface AgentOrchestrationConfig {
  /** Thin is the production default; other policies support controlled comparison. */
  executionPolicy?: "direct" | "thin" | "full";
  provider: AiProviderId;
  model: string;
  localAiSource?: "managed" | "ollama";
  providerConfigured?: boolean;
  permissionLevel: AgentPermissionLevel;
  activeRoleId: string;
  customSystemPrompt?: string;
  harnessGates: HarnessGateConfig;
  mcpPermissions: { workspaceSearch: boolean; diagramTemplate: boolean; webFetch: boolean };
}

export interface HostAdapter {
  platform: "ztools" | "atools" | "web";
  isAtools: boolean;
  hasAi: boolean;
  ai: (
    options: { prompt: string; systemPrompt?: string; model?: string },
    onChunk?: (chunk: string) => void
  ) => Promise<string> & { abort?: () => void };
  allAiModels: () => Promise<Array<{ id: string; name: string; description?: string }>>;
  redirectAiModelsSetting?: () => void;
  dbStorage: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  };
  rustBridge?: {
    isAvailable: boolean;
    parseMarkdownAst?: (raw: string) => Promise<unknown>;
    computeMyersDiff?: (a: string, b: string) => Promise<unknown>;
  };
}
