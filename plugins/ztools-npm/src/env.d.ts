/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

import type { NpmMeta, ParsedQuery, SearchResult, NpmSource } from './lib/types'

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

// Preload services 类型声明（对应根目录 preload.js）
interface GlobalPkg {
  name: string
  version: string
  description: string
  path: string
  extraneous?: boolean
  missing?: boolean
}

interface NodeVer {
  version: string
  current: boolean
  currentGlobal?: boolean
  npmBin: string
  prefix: string
  available: boolean
}
interface Services {
  npmSearch(query: ParsedQuery): Promise<SearchResult>
  npmMeta(name: string, source?: NpmSource): Promise<NpmMeta>
  readFile(filePath: string): string
  writeFile(filePath: string, content: string): string
  setProxy(url: string): string
  getProxy(): string
  npmListGlobal(opts?: { npmBin?: string; prefix?: string }): Promise<{
    packages: GlobalPkg[]
    debug: {
      npmBin: string
      prefix: string
      problems: unknown[]
      rawStdout: string
      rawStderr: string
    }
  }>
  npmUninstallGlobal(name: string, opts?: { npmBin?: string; prefix?: string }): Promise<{ stdout: string; stderr: string }>
  npmUpdateGlobal(name: string, opts: { npmBin?: string; prefix?: string }): Promise<{ stdout: string; stderr: string }>
  npmUpdateAllGlobal(opts: { npmBin?: string; prefix?: string }): Promise<{ stdout: string; stderr: string }>
  npmInstallGlobal(opts: { name: string; version?: string; npmBin?: string; prefix?: string; registry?: string }): Promise<{ stdout: string; stderr: string }>
  nodeListVersions(): Promise<{
    manager: string
    sourceDir: string
    currentGlobalVersion: string
    versions: NodeVer[]
    debug?: string[]
  }>
  detectCurrentGlobalNode(): Promise<{ nodePath: string; version: string } | null>
  switchCommandForManager(manager: string, version: string): string
  defaultCommandForManager(manager: string, version: string): string
}

// 宿主 ztools 运行时 API 补齐：@ztools-center/ztools-api-types 类型包未声明 clipboard，
// 但宿主实际暴露 ztools.clipboard.writeContent（同 ztools-maven 的 copyContent 用法）。
declare global {
  interface Window {
    services: Services
  }

  interface ZToolsApi {
    clipboard: {
      writeContent(opts: { type: 'text' | 'image'; content: string; shouldPaste?: boolean }): Promise<void>
    }
  }
}

export {}
