/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

import type {
  ConnectionInput,
  ConnectionProfile,
  DslIssue,
  EsRequestOptions,
  EsResponse,
  MappingField,
  SettingsDoc,
} from './types'

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

declare module '*?worker' {
  const workerConstructor: {
    new (): Worker
  }
  export default workerConstructor
}

/** Preload services — matches src-ztools/preload/services.js (window.services) */
export interface Services {
  listConnections: () => Promise<ConnectionProfile[]>
  getActiveConnection: () => Promise<ConnectionProfile | null>
  getSettings: () => Promise<SettingsDoc>
  saveConnection: (input: ConnectionInput, id?: string) => Promise<ConnectionProfile>
  deleteConnection: (id: string) => Promise<void>
  setActiveConnection: (id: string | null) => Promise<ConnectionProfile | null>
  getConnection: (id: string) => Promise<ConnectionProfile | null>
  request: (options: EsRequestOptions) => Promise<EsResponse>
  testConnection: (connectionId?: string) => Promise<EsResponse>
  testConnectionInput: (input: ConnectionInput) => Promise<EsResponse>
  clusterHealth: () => Promise<EsResponse>
  clusterInfo: () => Promise<EsResponse>
  listNodes: () => Promise<EsResponse>
  listIndices: () => Promise<EsResponse>
  getMapping: (index: string) => Promise<EsResponse>
  getIndexSettings: (index: string) => Promise<EsResponse>
  listAliases: () => Promise<EsResponse>
  createIndex: (
    index: string,
    body?: { settings?: Record<string, unknown>; mappings?: unknown },
  ) => Promise<EsResponse>
  updateIndexSettings: (index: string, settings: Record<string, unknown>) => Promise<EsResponse>
  putIndexMapping: (index: string, mappings: unknown) => Promise<EsResponse>
  updateAliases: (actions: unknown[]) => Promise<EsResponse>
  deleteIndex: (index: string) => Promise<EsResponse>
  reindex: (body: unknown, timeoutMs?: number) => Promise<EsResponse>
  search: (index: string, body: unknown) => Promise<EsResponse>
  getDoc: (index: string, id: string) => Promise<EsResponse>
  indexDoc: (index: string, id: string | null, body: unknown) => Promise<EsResponse>
  deleteDoc: (index: string, id: string) => Promise<EsResponse>
  validateDsl: (
    text: string,
    mappingBody?: unknown,
  ) => { issues: DslIssue[]; body: unknown | null }
  flattenMapping: (mappingBody: unknown) => MappingField[]
  getUiState: <T = unknown>(id: string) => Promise<T | null>
  saveUiState: <T = unknown>(id: string, payload: T) => Promise<void>
  uiStateIds: { search: string; rest: string }
  toast: (message: string, type?: 'success' | 'error' | 'info') => void
}

declare global {
  interface Window {
    services: Services
    ztools?: {
      showToast?: (message: string, options?: Record<string, unknown>) => unknown
      setExpendHeight?: (height: number) => void
      onPluginEnter?: (cb: (action: { code?: string }) => void) => void
      onPluginOut?: (cb: (isKill: boolean) => void) => void
    }
  }
}

export {}
