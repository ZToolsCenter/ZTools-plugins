import type {
  GifOptions,
  ImageJobSettings,
  MergeImagesOptions,
  ProcessResult,
  SharpRuntimeStatus,
  SourceFile
} from "../shared/types";

export interface ZToolsImageBatchServices {
  resolveFiles(paths: string[]): Promise<SourceFile[]>;
  runtimeStatus(): Promise<SharpRuntimeStatus>;
  installRuntime(): Promise<SharpRuntimeStatus>;
  processImages(paths: string[], settings: ImageJobSettings): Promise<ProcessResult[]>;
  mergePdfs(paths: string[], outputPath: string): Promise<string>;
  mergeImages(paths: string[], outputPath: string, options: MergeImagesOptions): Promise<string>;
  createGif(paths: string[], outputPath: string, options: GifOptions): Promise<string>;
  chooseFiles(): Promise<SourceFile[]>;
  captureScreen(): Promise<SourceFile[]>;
  canCaptureScreen(): boolean;
  chooseDirectory(): Promise<string | undefined>;
  chooseWatermarkImage(): Promise<string | undefined>;
  savePath(defaultPath: string, extensions: string[]): Promise<string | undefined>;
  getDefaultOutputDirectory(): string;
  fileUrl(filePath: string): string;
  getPathForFile(file: File): string;
  reveal(filePath: string): void;
  hostCompatibility(): { version: string; supported: boolean };
  canStartDrag(): boolean;
  startDrag(paths: string[] | string): Promise<void>;
}

declare global {
  interface Window {
    services: ZToolsImageBatchServices;
    ztools?: {
      showNotification?: (body: string) => void;
      getAppVersion?: () => string;
      screenCapture?: (callback: (image: string, bounds?: unknown) => void) => unknown;
      startDrag?: (paths: string[] | string) => unknown;
      dbStorage?: {
        getItem: (key: string) => unknown;
        setItem: (key: string, value: unknown) => void;
      };
    };
  }
}
