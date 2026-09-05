export type FormatId =
  | "docx" | "xlsx" | "pptx" | "pdf"
  | "png" | "jpeg" | "webp" | "avif" | "tiff" | "gif" | "bmp"
  | "txt" | "md" | "html" | "csv" | "tsv" | "json";

export type ConversionProfile = "visual" | "editable" | "extract";
export type CollisionPolicy = "skip" | "rename" | "overwrite";
export type QualityLevel = "lossless" | "visual" | "semantic" | "ocr";
export type JobStatus = "queued" | "running" | "succeeded" | "partial" | "failed" | "cancelled";
export type ItemStatus = "queued" | "running" | "succeeded" | "failed" | "skipped" | "cancelled";

export interface FormatDefinition {
  id: FormatId;
  label: string;
  family: "office" | "pdf" | "image" | "text" | "data";
  extensions: string[];
  color: string;
}

export interface InputFile {
  name: string;
  path: string;
  extension: string;
  format: FormatId;
  family: FormatDefinition["family"];
  size: number;
}

export interface InputGrant {
  id: string;
  files: InputFile[];
  totalBytes: number;
  expiresAt: number;
}

export interface OutputGrant {
  id: string;
  directory: string;
  expiresAt: number;
}

export interface RuntimeInfo {
  id: "officecli" | "browser" | "libreoffice" | "sharp" | "pdf" | "ocr" | "excel";
  label: string;
  available: boolean;
  version?: string;
  path?: string;
  bundled: boolean;
  installable?: boolean;
  estimateMb?: number;
  note: string;
}

export interface ConversionRoute {
  source: FormatId;
  target: FormatId;
  profile: ConversionProfile;
  quality: QualityLevel;
  engines: string[];
  available: boolean;
  multiOutput: boolean;
  warnings: string[];
  description: string;
}

export interface ConversionCapabilities {
  formats: FormatDefinition[];
  routes: ConversionRoute[];
  runtimes: RuntimeInfo[];
  limits: {
    maxUiFiles: number;
    maxMcpFiles: number;
    maxTotalBytes: number;
    maxFileBytes: number;
    maxPdfBytes: number;
    maxImagePixels: number;
    maxPdfPages: number;
  };
}

export interface ConversionOptions {
  dpi?: number;
  quality?: number;
  ocrLanguages?: string[];
  allowFallback?: boolean;
  preserveMetadata?: boolean;
}

export interface ConversionRequest {
  inputGrantId: string;
  outputGrantId: string;
  target: FormatId;
  profile: ConversionProfile;
  collision: CollisionPolicy;
  options: ConversionOptions;
}

export interface ConversionPlan {
  request: ConversionRequest;
  items: Array<{
    input: InputFile;
    route: ConversionRoute;
    proposedOutputs: string[];
  }>;
  executable: boolean;
  warnings: string[];
  estimatedOutputCount: number;
}

export interface JobItem {
  id: string;
  input: InputFile;
  status: ItemStatus;
  progress: number;
  route: ConversionRoute;
  outputs: string[];
  warnings: string[];
  error?: { code: string; message: string };
  startedAt?: number;
  completedAt?: number;
}

export interface ConversionJob {
  id: string;
  status: JobStatus;
  progress: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  outputDirectory: string;
  target: FormatId;
  profile: ConversionProfile;
  collision: CollisionPolicy;
  items: JobItem[];
  summary: { total: number; succeeded: number; failed: number; skipped: number; cancelled: number };
}

export type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; details?: unknown } };

export interface FormatConverterApi {
  getCapabilities(): Promise<ApiEnvelope<ConversionCapabilities>>;
  refreshRuntimes(): Promise<ApiEnvelope<RuntimeInfo[]>>;
  selectInputs(): Promise<ApiEnvelope<InputGrant | null>>;
  captureScreen(): Promise<ApiEnvelope<InputGrant>>;
  canCaptureScreen(): boolean;
  acceptInputs(paths: string[]): Promise<ApiEnvelope<InputGrant>>;
  selectOutputDirectory(): Promise<ApiEnvelope<OutputGrant | null>>;
  getApprovedRoots(): Promise<ApiEnvelope<string[]>>;
  removeApprovedRoot(root: string): Promise<ApiEnvelope<string[]>>;
  planConversion(request: ConversionRequest): Promise<ApiEnvelope<ConversionPlan>>;
  startConversion(request: ConversionRequest): Promise<ApiEnvelope<ConversionJob>>;
  getJob(jobId: string): Promise<ApiEnvelope<ConversionJob>>;
  cancelJob(jobId: string): Promise<ApiEnvelope<ConversionJob>>;
  retryFailed(jobId: string): Promise<ApiEnvelope<ConversionJob>>;
  installRuntime(runtimeId: string): Promise<ApiEnvelope<RuntimeInfo[]>>;
  installOfficeCli(): Promise<ApiEnvelope<RuntimeInfo>>;
  revealPath(path: string): Promise<ApiEnvelope<true>>;
  hostCompatibility(): { version: string; supported: boolean };
  canStartDrag(): boolean;
  startDrag(paths: string[]): Promise<ApiEnvelope<true>>;
}

export interface ZToolsLaunchParam {
  code?: string;
  type?: string;
  payload?: unknown;
}

export interface ZToolsApi {
  onPluginEnter?(callback: (param: ZToolsLaunchParam) => void): void;
  onPluginOut?(callback: () => void): void;
  getPathForFile?(file: File): string;
  getPath?(name: string): string;
  getAppVersion?(): string;
  screenCapture?(callback: (image: string, bounds?: unknown) => void, autoConfirm?: boolean): unknown;
}

declare global {
  interface Window {
    formatConverter?: FormatConverterApi;
    ztools?: ZToolsApi;
  }
}
