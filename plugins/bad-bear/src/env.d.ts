/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

import type {
  HashFileResult,
  InjectedPluginRecord,
  InstalledPlugin,
  OperationResult,
  PluginLaunchOptions,
  PluginLaunchResult,
  PluginMarketFetchResponse,
  PluginMarketPlugin,
  PluginMutationResult,
  PluginReadmeResponse,
} from './types/pluginMarket'

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

interface SystemInfo {
  platform: 'win32' | 'darwin' | 'linux'
}

interface ThemeInfo {
  isDark: boolean
  primaryColor?: string
  customColor?: string
  windowMaterial: string
}

interface Services {
  getSystemInfo(): SystemInfo
  getThemeInfo(): ThemeInfo
  onThemeChange(callback: (theme: ThemeInfo) => void): void
  readFile: (filePath: string, encoding?: string) => string
  readBinaryFile: (filePath: string) => Uint8Array
  writeFile: (filePath: string, content: string) => void
  computeFileHash: (filePath: string, algorithm?: 'sha256') => Promise<string>
  exists: (path: string) => boolean
  path: {
    join: (...paths: string[]) => string
    dirname: (path: string) => string
    basename: (path: string, ext?: string) => string
  }
  rename: (oldPath: string, newPath: string) => void
  removeDirectory: (dirPath: string) => void
  removeFile: (filePath: string) => void
  copyFile: (src: string, dest: string) => void
  copyDirectory: (src: string, dest: string) => void
}

interface ImageAnalysisResult {
  isSimpleIcon: boolean
  mainColor: string | null
  isDark: boolean
  needsAdaptation: boolean
}

interface HotkeyRecordingResult extends OperationResult {}

type HotkeyRecordedCallback = (shortcut: string) => void

interface ZToolsInternal {
  getAllPlugins(): Promise<InjectedPluginRecord[]>
  fetchPluginMarket(baseUrl?: string): Promise<PluginMarketFetchResponse>
  getPlugins(): Promise<InstalledPlugin[]>
  installPluginFromMarket(plugin: PluginMarketPlugin): Promise<PluginMutationResult>
  deletePlugin(pluginPath: string): Promise<OperationResult>
  getPluginReadme(target: string): Promise<PluginReadmeResponse>
  dbGet?(key: string): Promise<unknown>
  getPlatform?(): string
  launch?(options: PluginLaunchOptions): Promise<PluginLaunchResult | void>
  getRunningPlugins?(): Promise<string[]>
  reloadPlugin?(pluginPath: string): Promise<OperationResult>
  killPlugin?(pluginPath: string): Promise<OperationResult>
  revealInFinder?(targetPath: string): Promise<void>
  computeFileHash?(filePath: string, algorithm?: 'sha256'): Promise<HashFileResult>
  analyzeImage?(src: string): Promise<ImageAnalysisResult>
  startHotkeyRecording?(): Promise<HotkeyRecordingResult>
  onHotkeyRecorded?(callback: HotkeyRecordedCallback): void
}

interface ZToolsApi {
  internal: ZToolsInternal
  getThemeInfo?(): ThemeInfo
  onThemeChange?(callback: (theme: ThemeInfo) => void): void
  showTip(message: string): void
  showToast(message: string): void
  shellOpenExternal(url: string): void
  getPath(name: string): string
  onPluginEnter(callback: (action: any) => void): void
  onPluginOut(callback: () => void): void
}

declare global {
  const __APP_VERSION__: string

  interface Window {
    services: Services
    ztools: ZToolsApi
  }
}

export {}
