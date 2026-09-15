/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

export type TabType = 'unlock' | 'shredder' | 'port'

export interface ProcessInfo {
  pid: number
  name: string
  exePath: string
  source?: string
  reason?: string
  cmdLine?: string
  score?: number
}

export interface OperationResult {
  success: boolean
  message: string
}

export interface PortInfo {
  pid: number
  processName: string
  exePath: string
  protocol: 'TCP' | 'UDP'
  state: string
  localAddress: string
  localPort: number
}

export interface ShredderResult extends OperationResult {
  filesProcessed?: number
  locked?: boolean
}

export interface Services {
  findLockingProcesses: (filePath: string) => Promise<ProcessInfo[]>
  killProcess: (pid: number) => Promise<OperationResult>
  shredPath: (filePath: string, mode: 'delete' | 'shred') => Promise<ShredderResult>
  findPortProcess: (port: number) => Promise<PortInfo[]>
  getDebugLog: () => string[]
  getPathForFile: (file: File) => string
}

declare global {
  interface Window {
    services: Services
    ztools: ZToolsApi & { getPathForFile(file: File): string }
  }
}

export {}
