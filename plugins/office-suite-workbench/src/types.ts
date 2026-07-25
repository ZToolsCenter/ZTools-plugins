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
  run(
    command: string | string[],
    options?: { timeoutMs?: number }
  ): Promise<ApiResult<OfficeCliRunOutput>>;
  runForAi(
    command: string | string[],
    options: { allowWrite: boolean }
  ): Promise<ApiResult<OfficeCliRunOutput>>;
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
  id: string;
  label: string;
  description?: string;
  icon?: string;
  cost?: number;
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
