/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

// Preload services 类型声明（对应 public/preload.js）
interface Services {
  readFile: (file: string) => string
  writeTextFile: (text: string) => string
  writeImageFile: (base64Url: string) => string | undefined
  getVSCodeHistory: (dbPath: string) => Promise<string[]>
  deleteVSCodeHistory: (dbPath: string, targetPath: string) => Promise<boolean>
  deleteMultipleVSCodeHistory: (dbPath: string, targetPaths: string[]) => Promise<number>
  getAllIDEConfigs: () => IDEConfigWithKey[]
  saveIDEConfig: (config: IDEConfig) => void
  deleteIDEConfig: (code: string) => void
  createDefaultIDE: (code: string, command: string) => IDEConfig
  parsePathEntry: (entry: any) => string
  shellExec: (cmd: string, options?: { timeout?: number }) => Promise<string>
  getAllDbStorageKeys: (prefix?: string) => string[]
  getPath: (dir: string) => string
  getConnectPath: () => string
  _uriToFileSystemPath: (uri: string) => string
  _uriToOSPath: (uri: string) => string
  _dirExists: (uri: string) => boolean
}

interface IDEConfigWithKey extends IDEConfig {
  _configKey: string
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
