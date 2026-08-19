export type CustomAIProtocol = "openai-responses" | "openai" | "claude";

/** 与 presets.ts 中 AIProviderId 对齐；此处用 string 避免循环依赖，运行时校验。 */
export type AIProviderIdLike =
  | "deepseek"
  | "glm"
  | "minimax"
  | "custom-openai-responses"
  | "custom-openai"
  | "custom-claude";

export interface AIModelOption {
  id: string;
  label: string;
  description?: string;
}

export type AIReasoningLevel = "default" | "low" | "medium" | "high";

export interface AISettingsLike {
  enabled: boolean;
  selectedModelId: string | null;
  workspaceReasoningLevel: AIReasoningLevel;
  /** 供应商预设；缺省时由 base URL / 协议推断 */
  customProviderId?: AIProviderIdLike | string | null;
  customProtocol: CustomAIProtocol;
  customOpenAIResponsesBaseURL: string;
  customOpenAIBaseURL: string;
  customClaudeBaseURL: string;
  customOpenAIResponsesApiKey: string;
  customOpenAIApiKey: string;
  customClaudeApiKey: string;
  customModelOptions: AIModelOption[];
}

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content?: string;
}

export type AIStreamPhase =
  | "connecting"
  | "thinking"
  | "generating"
  | "finishing";

export interface AIStreamUpdate {
  phase: AIStreamPhase;
  text: string;
  reasoningText: string;
}

export interface AIRequestOverrides {
  selectedModelId?: string | null;
  reasoningLevel?: AIReasoningLevel | null;
}

export interface RunAITextOptions {
  abortSignal?: AbortSignal;
  requestOverrides?: AIRequestOverrides;
}

export interface RunAITextStreamOptions extends RunAITextOptions {
  onUpdate?: (update: AIStreamUpdate) => void;
  streamIdleTimeoutMs?: number;
}
