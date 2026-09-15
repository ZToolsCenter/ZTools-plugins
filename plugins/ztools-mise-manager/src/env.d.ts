/// <reference types="vite/client" />

import type {
  InstalledTool,
  RegistryTool,
  OutdatedItem,
  ConfigFile,
  Project,
  SystemInfo,
} from "./types";

interface MiseManagerApi {
  platform: string;
  getSystemInfo(): Promise<SystemInfo>;
  getInstalledTools(): Promise<{ ok: boolean; error?: string; tools: InstalledTool[] }>;
  getToolInfo(tool: string): Promise<{ ok: boolean; text: string }>;
  getRemoteVersions(tool: string): Promise<{ ok: boolean; error?: string; versions: string[] }>;
  install(
    tool: string,
    version?: string,
    cb?: { onLog?: (text: string) => void; onProgress?: (p: number) => void }
  ): Promise<string>;
  uninstall(tool: string, version: string): Promise<string>;
  setGlobal(tool: string, version: string): Promise<string>;
  setProject(tool: string, version: string, projectPath?: string): Promise<string>;
  getOutdated(): Promise<{ ok: boolean; list: OutdatedItem[]; raw: string }>;
  upgrade(tool?: string, cb?: { onLog?: (t: string) => void; onProgress?: (p: number) => void }): Promise<string>;
  selfUpdate(cb?: { onLog?: (t: string) => void; onProgress?: (p: number) => void }): Promise<string>;
  getRegistry(): Promise<{ ok: boolean; error?: string; tools: RegistryTool[] }>;
  getConfigFiles(): Promise<{ ok: boolean; files: ConfigFile[]; raw: string }>;
  readConfigFile(filePath: string): { ok: boolean; content?: string; error?: string };
  saveConfigFile(filePath: string, content: string): { ok: boolean; error?: string };
  selectFolder(): Promise<string | null>;
  projects: {
    load(): Project[];
    save(list: Project[]): void;
    add(p: Project): Project[];
    remove(path: string): Project[];
  };
  openInstallDir(tool: string, version: string): boolean;
  notify(title: string, body: string): void;
  openExternal(url: string): void;
}

declare global {
  interface Window {
    miseManager: MiseManagerApi;
    ztools?: any;
  }
}

export {};
