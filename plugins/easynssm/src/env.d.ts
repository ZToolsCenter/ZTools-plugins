/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

import type { CmdResult, NssmConfig, NssmDetect, ServiceInfo } from './api'

// Preload services 类型声明（对应 src-ztools/preload/services.js）
export interface Services {
  isAdmin: () => Promise<boolean>
  listServices: () => Promise<{ ok: boolean; services: ServiceInfo[]; error?: string }>
  getNssmConfig: (
    name: string
  ) => Promise<{ ok: boolean; config?: NssmConfig; error?: string }>
  detectNssm: () => Promise<NssmDetect>
  getNssmPath: () => string
  saveNssmPath: (p: string) => Promise<{ ok: boolean; message: string }>
  runCommands: (ops: string[], timeout?: number) => Promise<CmdResult>
  buildNssmOps: (payload: Record<string, unknown>) => string[]
  buildRemoveOp: (nssmPath: string, name: string) => string
  buildServiceActionOps: (name: string, action: 'start' | 'stop' | 'restart') => string[]
  buildStartTypeOp: (name: string, startType: string) => string[]
  readLogTail: (
    p: string,
    maxLines?: number
  ) => Promise<{ ok: boolean; content?: string; truncated?: boolean; error?: string }>
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
