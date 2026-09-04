export type ViewId = "home" | "ai" | "word" | "excel" | "powerpoint" | "console" | "mcp";
export type OfficeFormat = "word" | "excel" | "powerpoint";

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

export interface OfficeCliStatus {
  installed: boolean;
  binaryPath?: string;
  version?: string;
}

export interface OfficeCliInstallResult extends OfficeCliStatus {
  installed: true;
  release: string;
  asset: string;
}

export interface OfficeCliUpdateInfo {
  installed: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  checkedAt: string;
}

export interface OfficeCliRunOutput {
  command?: string;
  args?: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  json?: unknown;
  durationMs?: number;
  previewImages?: OfficeCliPreviewImage[];
}

export interface OfficeCliPreviewImage {
  path: string;
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  size: number;
  dataUrl: string;
}

export interface AiCancelResult {
  cancelled: number;
  settled: boolean;
}

export interface McpProbe {
  serverInfo?: { name?: string; version?: string };
  protocolVersion?: string;
  toolNames?: string[];
}

export interface McpConfigurations {
  binaryPath?: string;
  configs: Record<string, unknown>;
}

export interface OfficeSuiteApi {
  getStatus(): Promise<ApiResult<OfficeCliStatus>>;
  installOfficeCli(): Promise<ApiResult<OfficeCliInstallResult>>;
  checkOfficeCliUpdate(): Promise<ApiResult<OfficeCliUpdateInfo>>;
  updateOfficeCli(): Promise<ApiResult<OfficeCliInstallResult>>;
  run(
    command: string | string[],
    options?: { timeoutMs?: number }
  ): Promise<ApiResult<OfficeCliRunOutput>>;
  runForAi(
    command: string | string[],
    options: { allowWrite: boolean }
  ): Promise<ApiResult<OfficeCliRunOutput>>;
  cancelAiRuns(): Promise<AiCancelResult>;
  getMcpStatus(): Promise<ApiResult<unknown>>;
  registerMcp(
    target: "lms" | "claude" | "cursor" | "vscode"
  ): Promise<ApiResult<unknown>>;
  unregisterMcp(
    target: "lms" | "claude" | "cursor" | "vscode"
  ): Promise<ApiResult<unknown>>;
  probeMcp(): Promise<ApiResult<McpProbe>>;
  getMcpConfigs(): Promise<ApiResult<McpConfigurations>>;
}

export interface ZToolsAiModel {
  /** `value` is returned by official ZTools models; older hosts use `id`. */
  id?: string;
  value?: string;
  label?: string;
  modelId?: string;
  description?: string;
  icon?: string;
  cost?: number;
  providerId?: string;
  providerLabel?: string;
  /** Compatibility with early 3.2 development payloads. */
  provider?: string;
  contextWindow?: number;
  inputModalities?: string[];
  reasoning?: {
    efforts?: Array<{ id?: string; label?: string }>;
    defaultEffort?: string;
  };
  /** Compatibility with early 3.2 development payloads. */
  reasoningEfforts?: string[];
  defaultEffort?: string;
}

export interface ZToolsAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  reasoning_content?: string;
}

export interface ZToolsAiRequest extends PromiseLike<void> {
  abort(): void;
  catch<TResult = never>(
    onRejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null
  ): Promise<void | TResult>;
  finally(onFinally?: (() => void) | null): Promise<void>;
}

export interface ZToolsAiOptions {
  model?: string;
  /** Optional in 3.2.0; ignored by earlier ZTools hosts. */
  reasoningEffort?: string;
  messages: ZToolsAiMessage[];
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
      required?: string[];
    };
  }>;
}

export interface ZToolsApi {
  onPluginEnter?(callback: (payload: unknown) => void): void;
  onPluginOut?(callback: () => void): void;
  getAppVersion?(): string;
  showOpenDialog?(options: Record<string, unknown>): Promise<unknown> | unknown;
  showSaveDialog?(options: Record<string, unknown>): Promise<unknown> | unknown;
  copyText?(text: string): void;
  shellOpenExternal?(url: string): Promise<unknown> | unknown;
  shellOpenPath?(path: string): Promise<unknown> | unknown;
  allAiModels?(): Promise<ZToolsAiModel[]>;
  ai?(
    options: ZToolsAiOptions,
    onChunk?: (chunk: ZToolsAiMessage) => void
  ): ZToolsAiRequest;
}

declare global {
  interface Window {
    officeSuite?: OfficeSuiteApi;
    ztools?: ZToolsApi;
    office_document?: (input: Record<string, unknown>) => Promise<unknown>;
  }
}
