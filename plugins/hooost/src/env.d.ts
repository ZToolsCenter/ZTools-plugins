/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

declare module 'ace-builds/src-noconflict/ace' {
  import ace from 'ace-builds'
  export default ace
}

declare module 'ace-builds/src-noconflict/*'

interface ApplyResult {
  success: boolean
  error?: string
  backupPath?: string
  tmpFile?: string
}

interface RestoreResult {
  success: boolean
  error?: string
}

interface BackupInfo {
  filename: string
  path: string
  createdAt: string
}

interface ThemeInfo {
  isDark: boolean
  primaryColor?: string
  customColor?: string
  windowMaterial: string
}

interface SystemInfo {
  platform: 'win32' | 'darwin' | 'linux'
  hostsPath: string
  dataDir: string
}

interface Services {
  getSystemInfo(): SystemInfo
  getThemeInfo(): ThemeInfo
  onThemeChange(callback: (theme: ThemeInfo) => void): void
  readHosts(): string
  listBackups(): BackupInfo[]
  applyHosts(content: string, envName?: string): Promise<ApplyResult>
  restoreBackup(backupPath: string): Promise<RestoreResult>
}

interface ImageAnalysisResult {
  isSimpleIcon: boolean
  mainColor: string | null
  isDark: boolean
  needsAdaptation: boolean
}

interface ZToolsReadmeResult {
  success: boolean
  content?: string
  error?: string
}

interface ZToolsOperationResult {
  success: boolean
  error?: string
}

interface ZToolsDocItem {
  key: string
  type: 'document' | 'attachment'
}

interface ZToolsDocResult {
  success: boolean
  data?: Record<string, unknown> | null
  type?: 'document' | 'attachment'
  error?: string
}

interface ZToolsDocKeysResult {
  success: boolean
  data?: ZToolsDocItem[]
  error?: string
}

interface ZToolsMemoryInfo {
  private: number
  shared: number
  total: number
}

interface ZToolsMemoryInfoResult {
  success: boolean
  data?: ZToolsMemoryInfo
  error?: string
}

declare global {
  interface ZToolsInternalApi {
    analyzeImage?(src: string): Promise<ImageAnalysisResult>
    getPlatform?(): 'darwin' | 'win32' | 'linux' | string
    startHotkeyRecording?(): Promise<ZToolsOperationResult>
    onHotkeyRecorded?(callback: (shortcut: string) => void): void
    dbGet?(key: string): Promise<unknown>
    dbPut?(key: string, value: unknown): Promise<unknown>
    getPluginReadme?(target: string): Promise<ZToolsReadmeResult>
    getPluginDocKeys?(pluginName: string): Promise<ZToolsDocKeysResult>
    getPluginDoc?(pluginName: string, key: string): Promise<ZToolsDocResult>
    clearPluginData?(pluginName: string): Promise<ZToolsOperationResult>
    getPluginMemoryInfo?(pluginPath: string): Promise<ZToolsMemoryInfoResult>
  }

  interface ZToolsApi {
    internal: ZToolsInternalApi
    dbStorage: {
      getItem<T>(key: string): T | null
      setItem(key: string, value: unknown): void
    }
    shellOpenExternal(url: string): void
    onPluginEnter(callback: () => void): void
    onPluginOut(callback: () => void): void
  }

  interface Window {
    services: Services
    ztools: ZToolsApi
  }
}

export {}
