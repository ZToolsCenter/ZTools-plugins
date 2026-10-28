/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

import type { EnvOp, EnvVar, Snapshot, SnapshotChange } from './api'

export interface PathCheckResult {
  raw: string
  expanded: string
  exists: boolean
}

export interface ApplyResult {
  ok: boolean
  error: string
  applied: number
}

// Preload services 类型声明（对应 src-ztools/preload/services.js）
export interface Services {
  isAdmin: () => Promise<boolean>
  listEnv: (scope: 'user' | 'machine') => Promise<{ ok: boolean; vars: EnvVar[]; error?: string }>
  applyOps: (scope: 'user' | 'machine', ops: EnvOp[]) => Promise<ApplyResult>
  takeSnapshot: (
    reason?: string,
    changes?: SnapshotChange[]
  ) => Promise<{ ok: boolean; snapshot?: Snapshot; error?: string }>
  listSnapshots: () => { ok: boolean; snapshots: Snapshot[] }
  deleteSnapshot: (id: string) => { ok: boolean }
  restoreSnapshot: (
    id: string
  ) => Promise<{ ok: boolean; userChanges?: number; machineChanges?: number; error?: string }>
  exportSnapshot: (id: string) => { ok: boolean; path?: string; error?: string }
  importSnapshot: () => { ok: boolean; snapshot?: Snapshot; error?: string }
  checkPaths: (entries: string[], envMap?: Record<string, string>) => PathCheckResult[]
  expandEnvValue: (value: string, envMap?: Record<string, string>) => string
  openPath: (
    target: string,
    envMap?: Record<string, string>
  ) => { ok: boolean; path?: string; isDir?: boolean; error?: string }
  listPresets: () => { ok: boolean; presets: Record<string, string[]> }
  savePresets: (presets: Record<string, string[]>) => {
    ok: boolean
    presets: Record<string, string[]>
    error?: string
  }
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
