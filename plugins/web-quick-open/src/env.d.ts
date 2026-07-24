/// <reference types="vite/client" />

declare global {
  type WebSearchEngineType = 'search' | 'webpage'

  interface WebSearchEngine {
    id: string
    name: string
    url: string
    icon: string
    enabled: boolean
    type: WebSearchEngineType
    keyword?: string
  }

  interface WebSearchResult<T = unknown> {
    success: boolean
    data?: T
    error?: string
  }

  interface WebQuickOpenImportResult {
    success: boolean
    importedCount?: number
    skippedCount?: number
    duplicateCount?: number
    invalidCount?: number
    totalCount?: number
    error?: string
  }

  interface LaunchParam {
    code?: string
    type?: string
    payload?: string
    inputState?: {
      searchQuery?: string
      pastedText?: string
    }
  }

  interface WebQuickOpenApi {
    getAll: () => Promise<WebSearchResult<WebSearchEngine[]>>
    add: (engine: WebSearchEngine) => Promise<WebSearchResult>
    update: (engine: WebSearchEngine) => Promise<WebSearchResult>
    delete: (engineId: string) => Promise<WebSearchResult>
    fetchFavicon: (url: string) => Promise<WebSearchResult<string>>
    importFromJsonText: (jsonText: string) => Promise<WebQuickOpenImportResult>
    openExternal: (url: string) => unknown
    hideMainWindow: () => unknown
    outPlugin: () => unknown
  }

  interface Window {
    webQuickOpen: WebQuickOpenApi
    ztools: {
      onPluginEnter: (callback: (param: LaunchParam) => void) => void
      showNotification?: (body: string) => void
      getThemeInfo?: () => {
        isDark: boolean
        primaryColor?: string
        customColor?: string
        windowMaterial?: string
      }
      onThemeChange?: (callback: (theme: unknown) => void) => void
      isMacOS?: () => boolean
      isMacOs?: () => boolean
      isWindows?: () => boolean
      isLinux?: () => boolean
    }
  }
}

export {}
