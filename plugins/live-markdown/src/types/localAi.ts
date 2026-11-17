/** Contract shared by the readable preload service and the assistant UI. */
export type LocalAiProfileId = "light" | "balanced" | "quality";
export type LocalAiSource = "managed" | "ollama";

export interface LocalAiPlan {
  id: LocalAiProfileId;
  label: string;
  modelId: string;
  downloadBytes: number;
  installedBytes: number;
  requiredFreeBytes: number;
  available: boolean;
  cached: boolean;
  reason?: string;
}

export interface LocalAiEnvironment {
  platform: string;
  arch: string;
  totalMemoryBytes: number;
  availableMemoryBytes: number;
  diskFreeBytes: number | null;
  dataDirectory: string;
  supported: boolean;
  reason?: string;
  recommendedProfile: LocalAiProfileId;
  plans: LocalAiPlan[];
  externalModels: Array<{ id: string; name: string }>;
}

export type LocalAiPhase = "idle" | "detecting" | "downloading" | "verifying"
  | "installing" | "starting" | "testing" | "ready" | "cancelled" | "error";

export interface LocalAiStatus {
  phase: LocalAiPhase;
  deploymentId: string | null;
  modelId: string | null;
  message: string;
  completedBytes: number;
  totalBytes: number;
  error?: string;
}

export interface LocalAiGenerateInput {
  requestId: string;
  source: LocalAiSource;
  modelId: string;
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  contextTokens?: number;
  outputSchema?: Record<string, unknown>;
}

export interface LocalAiBridge {
  inspect(): Promise<LocalAiEnvironment>;
  getStatus(): Promise<LocalAiStatus>;
  /** Starts a background deployment; completion is observed through getStatus. */
  deploy(profile: LocalAiProfileId): Promise<void>;
  cancelDeployment(): Promise<void>;
  /** Rejects incomplete, cancelled, or truncated generations; no fallback text. */
  generate(input: LocalAiGenerateInput, onChunk?: (chunk: string) => void): Promise<string>;
  cancelGeneration(requestId: string): Promise<void>;
  release(): Promise<void>;
  removeResources(): Promise<void>;
}
