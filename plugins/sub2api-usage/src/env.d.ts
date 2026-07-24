/// <reference types="vite/client" />

declare global {
  interface Sub2ApiKeyConfig {
    id: number
    alias: string
  }

  interface Sub2ApiUsageConfig {
    baseUrl: string
    authorization: string
    refreshToken: string
    apiKeys: Sub2ApiKeyConfig[]
    autoRefreshSeconds: number
  }

  interface Sub2ApiUsageRecord {
    id: number
    alias: string
    tokens: number
    inputTokens: number
    outputTokens: number
    cachedTokens: number
    requests: number
    todayCost: number
    cost: number
    raw: Record<string, unknown>
  }

  interface Sub2ApiUsageSummary {
    tokens: number
    inputTokens: number
    outputTokens: number
    cachedTokens: number
    requests: number
    todayCost: number
    cost: number
  }

  interface Sub2ApiUsagePayload {
    records: Sub2ApiUsageRecord[]
    summary: Sub2ApiUsageSummary
    fetchedAt: string
    authUpdated?: boolean
    config?: Sub2ApiUsageConfig
    raw: unknown
  }

  interface Sub2ApiResult<T = unknown> {
    success: boolean
    data?: T
    error?: string
  }

  interface Sub2ApiUsageApi {
    getConfig: () => Sub2ApiResult<Sub2ApiUsageConfig>
    saveConfig: (config: Sub2ApiUsageConfig) => Sub2ApiResult<Sub2ApiUsageConfig>
    fetchUsage: () => Promise<Sub2ApiResult<Sub2ApiUsagePayload>>
    refreshAuthToken: () => Promise<Sub2ApiResult<Sub2ApiUsageConfig>>
    dockFloatingWindow: () => Sub2ApiResult
    expandDockedFloatingWindow: () => Sub2ApiResult
    collapseDockedFloatingWindow: () => Sub2ApiResult
    moveFloatingWindow: (x: number, y: number) => Sub2ApiResult
    stopFloatingMove: () => Sub2ApiResult
    openFloatingWindow: () => Sub2ApiResult
    copyText: (text: string) => Sub2ApiResult
  }

  interface LaunchParam {
    code?: string
    type?: string
    payload?: unknown
  }

  interface Window {
    sub2ApiUsage: Sub2ApiUsageApi
    ztools?: {
      onPluginEnter?: (callback: (param: LaunchParam) => void) => void
      setExpendHeight?: (height: number) => void
      showNotification?: (body: string) => void
      dbStorage?: {
        getItem: (key: string) => unknown
        setItem: (key: string, value: unknown) => void
      }
      createBrowserWindow?: (url: string, options: Record<string, unknown>, callback?: () => void) => unknown
      copyText?: (text: string) => void
      sendToParent?: (channel: string, ...params: unknown[]) => void
      getCursorScreenPoint?: () => { x: number; y: number }
      getDisplayNearestPoint?: (point: { x: number; y: number }) => unknown
      getPrimaryDisplay?: () => unknown
      isDev?: () => boolean
    }
  }
}

export {}
