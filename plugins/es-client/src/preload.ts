import {
  deleteConnection,
  getActiveConnection,
  getConnection,
  listConnections,
  saveConnection,
  setActiveConnection,
} from './services/connectionStore'
import { getSettings } from './services/db'
import { flattenMappingProperties, parseDslJson, validateSearchBody } from './services/dslValidate'
import { esRequest } from './services/esHttpClient'
import { getUiState, saveUiState, UI_REST_ID, UI_SEARCH_ID } from './services/uiStateStore'
import type {
  ConnectionInput,
  ConnectionProfile,
  DslIssue,
  EsRequestOptions,
  EsResponse,
  MappingField,
  SettingsDoc,
} from './types'

type ZtoolsHost = {
  showToast?: (message: string, options?: Record<string, unknown>) => unknown
  setExpendHeight?: (height: number) => void
  onPluginEnter?: (cb: (param: { code?: string }) => void) => void
  onPluginOut?: (cb: (isKill: boolean) => void) => void
  outPlugin?: (isKill?: boolean) => unknown
}

function host(): ZtoolsHost {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (globalThis as any).ztools ?? (typeof window !== 'undefined' ? (window as any).ztools : {})
}

/**
 * ZTools 约定：preload 通过 window.services 向渲染进程注入能力
 * @see https://github.com/ZToolsCenter/ztools-plugin-cli/tree/main/templates/vue-vite
 */
const services = {
  listConnections: (): Promise<ConnectionProfile[]> => listConnections(),
  getActiveConnection: (): Promise<ConnectionProfile | null> => getActiveConnection(),
  getSettings: (): Promise<SettingsDoc> => getSettings(),
  saveConnection: (input: ConnectionInput, id?: string): Promise<ConnectionProfile> =>
    saveConnection(input, id),
  deleteConnection: (id: string): Promise<void> => deleteConnection(id),
  setActiveConnection: (id: string | null): Promise<ConnectionProfile | null> =>
    setActiveConnection(id),
  getConnection: (id: string): Promise<ConnectionProfile | null> => getConnection(id),

  request: (options: EsRequestOptions): Promise<EsResponse> => esRequest(options),

  testConnection: async (connectionId?: string): Promise<EsResponse> =>
    esRequest({ method: 'GET', path: '/', connectionId }),

  /** 未保存的表单也可直接测试 */
  testConnectionInput: async (input: ConnectionInput): Promise<EsResponse> =>
    esRequest({ method: 'GET', path: '/', profile: input }),

  clusterHealth: (): Promise<EsResponse> =>
    esRequest({ method: 'GET', path: '/_cluster/health' }),

  clusterInfo: (): Promise<EsResponse> => esRequest({ method: 'GET', path: '/' }),

  listNodes: (): Promise<EsResponse> => esRequest({ method: 'GET', path: '/_nodes' }),

  listIndices: (): Promise<EsResponse> =>
    esRequest({
      method: 'GET',
      path: '/_cat/indices',
      query: { format: 'json', h: 'health,status,index,uuid,pri,rep,docs.count,store.size' },
    }),

  getMapping: (index: string): Promise<EsResponse> =>
    esRequest({ method: 'GET', path: `/${encodeURIComponent(index)}/_mapping` }),

  getIndexSettings: (index: string): Promise<EsResponse> =>
    esRequest({ method: 'GET', path: `/${encodeURIComponent(index)}/_settings` }),

  listAliases: (): Promise<EsResponse> =>
    esRequest({ method: 'GET', path: '/_alias' }),

  createIndex: (
    index: string,
    body?: { settings?: Record<string, unknown>; mappings?: unknown },
  ): Promise<EsResponse> =>
    esRequest({
      method: 'PUT',
      path: `/${encodeURIComponent(index)}`,
      body: body ?? {},
    }),

  updateIndexSettings: (index: string, settings: Record<string, unknown>): Promise<EsResponse> =>
    esRequest({
      method: 'PUT',
      path: `/${encodeURIComponent(index)}/_settings`,
      body: settings,
    }),

  putIndexMapping: (index: string, mappings: unknown): Promise<EsResponse> =>
    esRequest({
      method: 'PUT',
      path: `/${encodeURIComponent(index)}/_mapping`,
      body: mappings,
    }),

  updateAliases: (actions: unknown[]): Promise<EsResponse> =>
    esRequest({
      method: 'POST',
      path: '/_aliases',
      body: { actions },
    }),

  deleteIndex: (index: string): Promise<EsResponse> =>
    esRequest({
      method: 'DELETE',
      path: `/${encodeURIComponent(index)}`,
    }),

  reindex: (body: unknown, timeoutMs?: number): Promise<EsResponse> =>
    esRequest({
      method: 'POST',
      path: '/_reindex',
      query: { wait_for_completion: true, refresh: true },
      body,
      timeoutMs: timeoutMs ?? 600_000,
    }),

  search: (index: string, body: unknown): Promise<EsResponse> =>
    esRequest({
      method: 'POST',
      path: `/${encodeURIComponent(index)}/_search`,
      body,
    }),

  getDoc: (index: string, id: string): Promise<EsResponse> =>
    esRequest({
      method: 'GET',
      path: `/${encodeURIComponent(index)}/_doc/${encodeURIComponent(id)}`,
    }),

  indexDoc: (index: string, id: string | null, body: unknown): Promise<EsResponse> => {
    if (id) {
      return esRequest({
        method: 'PUT',
        path: `/${encodeURIComponent(index)}/_doc/${encodeURIComponent(id)}`,
        body,
      })
    }
    return esRequest({
      method: 'POST',
      path: `/${encodeURIComponent(index)}/_doc`,
      body,
    })
  },

  deleteDoc: (index: string, id: string): Promise<EsResponse> =>
    esRequest({
      method: 'DELETE',
      path: `/${encodeURIComponent(index)}/_doc/${encodeURIComponent(id)}`,
    }),

  validateDsl: (
    text: string,
    mappingBody?: unknown,
  ): { issues: DslIssue[]; body: unknown | null } => {
    const parsed = parseDslJson(text)
    if (parsed.error) {
      return {
        issues: [{ severity: 'error', message: `JSON 无效：${parsed.error}` }],
        body: null,
      }
    }
    const fields: MappingField[] = mappingBody ? flattenMappingProperties(mappingBody) : []
    return { issues: validateSearchBody(parsed.value, fields), body: parsed.value }
  },

  flattenMapping: (mappingBody: unknown): MappingField[] => flattenMappingProperties(mappingBody),

  getUiState: <T = unknown>(id: string): Promise<T | null> => getUiState<T>(id),
  saveUiState: <T = unknown>(id: string, payload: T): Promise<void> => saveUiState(id, payload),
  uiStateIds: { search: UI_SEARCH_ID, rest: UI_REST_ID },

  toast: (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    try {
      host().showToast?.(message, { type })
    } catch {
      // host optional
    }
  },
}

// Official template pattern: inject via window.services
try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).services = services
} catch {
  // ignore
}

try {
  host().onPluginEnter?.(() => {
    try {
      host().setExpendHeight?.(620)
    } catch {
      // optional
    }
  })
} catch {
  // optional
}

export { services }
