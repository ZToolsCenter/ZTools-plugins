import type {
  GifOptions,
  ImageJobSettings,
  MergeImagesOptions,
  ProcessResult,
  SourceFile
} from "../shared/types";

export interface ZToolsImageBatchServices {
  resolveFiles(paths: string[]): Promise<SourceFile[]>;
  inspectFile(filePath: string): Promise<SourceFile>;
  processImages(paths: string[], settings: ImageJobSettings): Promise<ProcessResult[]>;
  mergePdfs(paths: string[], outputPath: string): Promise<string>;
  mergeImages(paths: string[], outputPath: string, options: MergeImagesOptions): Promise<string>;
  createGif(paths: string[], outputPath: string, options: GifOptions): Promise<string>;
  chooseFiles(): Promise<SourceFile[]>;
  chooseDirectory(): Promise<string | undefined>;
  chooseWatermarkImage(): Promise<string | undefined>;
  savePath(defaultPath: string, extensions: string[]): Promise<string | undefined>;
  getDefaultOutputDirectory(): string;
  fileUrl(filePath: string): string;
  getPathForFile(file: File): string;
  copyFile(filePath: string): boolean;
  copyImage(filePath: string): boolean;
  reveal(filePath: string): void;
  isImagePath(filePath: string): boolean;
  isPdfPath(filePath: string): boolean;
}

declare global {
  interface Window {
    services: ZToolsImageBatchServices;
    ztools?: {
      showNotification?: (body: string) => void;
      dbStorage?: {
        getItem: (key: string) => unknown;
        setItem: (key: string, value: unknown) => void;
      };
    };
  }
}
