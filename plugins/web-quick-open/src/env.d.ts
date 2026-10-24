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
    group?: string | null
    browserId?: string | null
    browser?: WebQuickOpenBrowser | null
  }

  interface WebQuickOpenBrowserProfile {
    id: string
    name: string
    icon: string
    path: string
    args: string[]
    builtin: boolean
    hidden: boolean
    platform: string[]
  }

  interface WebQuickOpenBrowser {
    executablePath: string
    mode: 'default' | 'private' | 'new-window'
    args: {
      default: string[]
      private: string[]
      newWindow: string[]
    }
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
    importedGroupCount?: number
    importedBrowserProfileCount?: number
    error?: string
  }

  interface LaunchParam {
    code?: string
    type?: string
    payload?: string
    option?: {
      action?: string
      url?: string
    }
    inputState?: {
      searchQuery?: string
      pastedText?: string
    }
  }

  interface WebQuickOpenApi {
    writeDebugLog: (event: string, details?: Record<string, string | number | boolean>) => void
    fetchBrowserIcon: (profile: WebQuickOpenBrowserProfile) => Promise<WebSearchResult<string>>
    getAll: () => Promise<WebSearchResult<WebSearchEngine[]>>
    getBrowserProfiles: (
      includeUnsupported?: boolean
    ) => Promise<WebSearchResult<WebQuickOpenBrowserProfile[]>>
    saveBrowserProfile: (
      profile: WebQuickOpenBrowserProfile
    ) => Promise<WebSearchResult<WebQuickOpenBrowserProfile[]>>
    deleteBrowserProfile: (
      profileId: string
    ) => Promise<WebSearchResult<WebQuickOpenBrowserProfile[]>>
    toggleBrowserProfileHidden: (
      profileId: string
    ) => Promise<WebSearchResult<WebQuickOpenBrowserProfile[]>>
    resetBrowserProfiles: () => Promise<WebSearchResult<WebQuickOpenBrowserProfile[]>>
    add: (engine: WebSearchEngine) => Promise<WebSearchResult>
    update: (engine: WebSearchEngine) => Promise<WebSearchResult>
    delete: (engineId: string) => Promise<WebSearchResult>
    getGroups: () => Promise<WebSearchResult<string[]>>
    createGroup: (name: string) => Promise<WebSearchResult<string[]>>
    renameGroup: (oldName: string, newName: string) => Promise<WebSearchResult<string[]>>
    deleteGroup: (name: string) => Promise<WebSearchResult<string[]>>
    fetchFavicon: (url: string) => Promise<WebSearchResult<string>>
    importFromJsonText: (jsonText: string) => Promise<WebQuickOpenImportResult>
    exportJson: () => Promise<WebSearchResult<string>>
    pickBrowserExecutable: () => Promise<WebSearchResult<string>>
    testOpen: (url: string, browser: WebQuickOpenBrowser) => Promise<WebSearchResult>
    testBrowserProfile: (
      url: string,
      profile: WebQuickOpenBrowserProfile
    ) => Promise<WebSearchResult>
    openEngine: (engineId: string, query?: string) => Promise<WebSearchResult>
    openExternal: (url: string) => unknown
    hideMainWindow: () => unknown
    outPlugin: () => unknown
  }

  interface Window {
    webQuickOpen: WebQuickOpenApi
    ztools: {
      onPluginEnter: (callback: (param: LaunchParam) => void) => void
      setSubInputValue?: (value: string) => unknown
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
