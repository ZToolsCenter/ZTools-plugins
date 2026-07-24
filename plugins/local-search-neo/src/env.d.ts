/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

import type {
  EverythingQueryItem,
  EverythingSortMode,
  EverythingVersion,
  FileTreeOptions,
  FileTreeResult,
  TextFileInspection,
  TextPreviewDirection,
  TextPreviewResult,
} from "../addon";

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}

// Preload services 类型声明（对应 public/preload/services.js）
interface FileInfo {
  fullPath: string;
  name: string;
  path: string;
  size?: number;
  modifiedAt?: number;
  isDirectory: boolean;
  exists: boolean;
}

interface EverythingStartupStatus {
  state: "idle" | "checking" | "starting" | "waiting" | "ready" | "error";
  message: string;
  managed: boolean;
  pid?: number;
  error?: string;
}

interface Services {
  everything: {
    isAvailable: () => boolean;
    isRunning: () => boolean;
    isDbLoaded: () => boolean;
    getStartupStatus: () => EverythingStartupStatus;
    ensureReady: (options?: { timeoutMs?: number }) => Promise<EverythingStartupStatus>;
    handlePluginOut: (isKill: boolean) => boolean;
    getVersion: () => EverythingVersion;
    query: (
      search: string,
      maxResults?: number,
      sortMode?: EverythingSortMode,
      matchPath?: boolean,
    ) => {
      total: number;
      items: EverythingQueryItem[];
    };
  };
  getFileInfo: (file: string) => Promise<FileInfo>;
  getFileUrl: (file: string) => string;
  readBinaryFile: (file: string) => Uint8Array;
  isTextFile: (file: string) => boolean;
  inspectTextFile: (file: string, maxBytes?: number) => TextFileInspection;
  readTextPreview: (
    file: string,
    maxBytes?: number,
    direction?: TextPreviewDirection,
  ) => TextPreviewResult;
  printDirectoryTree: (directory: string, options?: FileTreeOptions) => FileTreeResult;
  printArchiveTree: (file: string, options?: FileTreeOptions) => FileTreeResult;
}

declare global {
  interface Window {
    services: Services;
  }
}

export {};
