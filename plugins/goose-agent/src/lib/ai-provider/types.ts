export type CustomAIProtocol = "openai-responses" | "openai" | "claude";

/** 与 presets.ts 中 AIProviderId 对齐；此处用 string 避免循环依赖，运行时校验。 */
export type AIProviderIdLike =
  | "deepseek"
  | "xai"
  | "custom-openai-responses"
  | "custom-openai"
  | "custom-claude";

export interface AIModelOption {
  id: string;
  label: string;
  description?: string;
  /** 可选：该模型上下文窗口（tokens）；缺省时由 resolveContextWindowTokens 推断 */
  contextWindow?: number;
  /** 是否支持图片输入；未设置时由 modelSupportsVision 启发式判断 */
  supportsVision?: boolean;
}

export type AIReasoningLevel = "default" | "low" | "medium" | "high";

/** 鉴权模式；与 auth.ts 中 AIAuthMode 对齐 */
export type AIAuthModeLike = "api_key" | "oauth";

/** OAuth 会话形状；与 auth.ts 中 AIOAuthSession 对齐 */
export interface AIOAuthSessionLike {
  accessToken: string;
  refreshToken?: string;
  /** 过期时间，Unix 毫秒 */
  expiresAt?: number;
  accountLabel?: string;
  providerId?: string;
  /** 本机 CLI 来源（如 grok_cli / opencodex） */
  source?: string;
}

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
  /**
   * 各供应商最近一次成功拉取/导入的模型缓存。
   * Composer 聚合仅展示凭证有效的供应商。
   */
  modelsByProvider?: Partial<
    Record<
      | "deepseek"
      | "xai"
      | "custom-openai-responses"
      | "custom-openai"
      | "custom-claude",
      AIModelOption[]
    >
  >;
  /**
   * 各供应商隔离的 baseURL + apiKey 快照。
   * 多供应商共用协议槽时，以本 map 为其它供应商的真相源；
   * 请求路径优先读此快照，避免切换/导入 OAuth 覆盖共享槽后读错。
   */
  providerCredentials?: Partial<
    Record<
      | "deepseek"
      | "xai"
      | "custom-openai-responses"
      | "custom-openai"
      | "custom-claude",
      { baseURL: string; apiKey: string }
    >
  >;
  /** 首选鉴权；缺省 api_key（兼容旧数据） */
  preferredAuthMode?: AIAuthModeLike;
  /** OAuth 会话；一期可选 */
  oauthSession?: AIOAuthSessionLike | null;
  /** Composer 工作区覆盖模型（可为 provider/model） */
  workspaceSelectedModelId?: string | null;
  /** 供应商是否在 Composer 列表显示；仅 true 计入聚合 */
  enabledProviders?: Partial<
    Record<
      | "deepseek"
      | "xai"
      | "custom-openai-responses"
      | "custom-openai"
      | "custom-claude",
      boolean
    >
  >;
}

/** 多模态 content part（与 AgentChatContentPart 对齐）；image 的 dataBase64 无 data: 前缀。 */
export type AITextPart = { type: "text"; text: string };
export type AIImagePart = {
  type: "image";
  mediaType: string;
  dataBase64: string;
};
export type AIContentPart = AITextPart | AIImagePart;

export interface AIMessage {
  role: "system" | "user" | "assistant";
  /** 纯文本，或 agent 风格 parts；各 provider 边界再转协议 shape。 */
  content?: string | AIContentPart[];
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
