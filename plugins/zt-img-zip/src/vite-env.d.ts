/// <reference types="vite/client" />

interface ImageZipOptions {
  format: "original" | "jpeg" | "png" | "webp";
  quality: number;
  maxWidth: number;
  maxHeight: number;
  outputDir?: string;
  outputPath?: string;
  overwriteOriginal?: boolean;
  suffix: string;
  pngPalette?: boolean;
}

interface ImageZipResult {
  inputPath: string;
  outputPath: string;
  inputFormat: string;
  outputFormat: string;
  originalSize: number;
  outputSize: number;
  savedBytes: number;
  ratio: number;
}

interface ImageZipBufferItem {
  name: string;
  data: ArrayBuffer;
}

interface ImageZipFileInfo {
  path: string;
  name: string;
  size: number;
}

interface ImageZipFailure {
  ok: false;
  inputPath: string;
  error: string;
}

interface ImageZipSuccess {
  ok: true;
  result: ImageZipResult;
}

interface ImageZipCommitResult {
  outputPath: string;
  outputSize: number;
  overwroteOriginal: boolean;
}

interface Window {
  imageZipPreloadLoaded?: boolean;
  imageZipPreloadVersion?: string;
  imageZip?: {
    preloadVersion: string;
    compressImages: (filePaths: string[], options: ImageZipOptions) => Promise<Array<ImageZipSuccess | ImageZipFailure>>;
    compressImageBuffers: (
      items: ImageZipBufferItem[],
      options: ImageZipOptions,
    ) => Promise<Array<ImageZipSuccess | ImageZipFailure>>;
    saveOutputFile: (sourcePath: string, outputPath: string) => ImageZipCommitResult;
    overwriteOutputFile: (sourcePath: string, inputPath: string, outputFormat: string) => ImageZipCommitResult;
    getFileInfos: (
      filePaths: string[],
    ) => Array<{ ok: true; info: ImageZipFileInfo } | { ok: false; path: string; error: string }>;
    getDefaultSaveDir: () => string;
    getDefaultOutputDir: () => string;
    supportedInputFormats: string[];
    supportedOutputFormats: string[];
  };
  ztools?: {
    getPathForFile?: (file: File) => string;
    setExpendHeight?: (height: number) => void;
    showOpenDialog?: (options: Record<string, unknown>) => string[] | undefined;
    showSaveDialog?: (options: Record<string, unknown>) => string | undefined;
    shellShowItemInFolder?: (fullPath: string) => boolean;
  };
}
