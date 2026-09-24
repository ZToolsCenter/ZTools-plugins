// mise 相关类型定义

export interface ToolVersionItem {
  version: string;
  requested: string | null;
  installPath: string | null;
  source: string | null;
  active: boolean;
}

export interface InstalledTool {
  name: string;
  versions: ToolVersionItem[];
  activeVersion: string | null;
  installCount: number;
}

export interface RegistryTool {
  name: string;
  description: string;
  backends: string[];
  aliases: string[];
}

export interface OutdatedItem {
  tool: string;
  current: string;
  latest: string;
}

export interface ConfigFile {
  path: string;
  tools: string[];
}

export interface Project {
  path: string;
  name: string;
}

export interface SystemInfo {
  missing: boolean;
  version: string;
  configPath: string;
  installDir: string;
  settingsText: string;
}

export interface TaskProgress {
  tool: string;
  version: string;
  percent: number;
  logs: string[];
  running: boolean;
  error?: string;
}
