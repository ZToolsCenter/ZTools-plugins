/// <reference types="vite/client" />

export {}

declare global {
  type ZToolsFeatureEnterAction = {
    code?: string
    type?: string
    payload?: unknown
  }

  type ZToolsFilePayload = {
    path?: string
    name?: string
    isFile?: boolean
    type?: string
  }

  type DeepReadFishCommand = string | { type?: string; width?: number; height?: number; x?: number; y?: number }

  type DeepReadSourceRequest = {
    url: string
    method?: string
    headers?: Record<string, string>
    body?: string
    sourceId?: string
    sourceName?: string
    sourceUrl?: string
    enabledCookieJar?: boolean
    responseUrl?: string
  }

  type DeepReadServices = {
    readFile(filePath: string): string
    readClipboardText?(): string
    onFishCommand?(handler: (command: DeepReadFishCommand) => void): () => void
    fetchText?(request: DeepReadSourceRequest): Promise<string>
    fetchDataUrl?(request: DeepReadSourceRequest): Promise<string>
    rememberSourceCookie?(request: DeepReadSourceRequest, cookie: string): void
    clearSourceCookie?(request: DeepReadSourceRequest): void
    readTextFile(filePath: string): {
      name: string
      path: string
      content: string
      size: number
      mtime: number
    }
    getFileInfo(filePath: string): {
      name: string
      path: string
      size: number
      mtime: number
    }
  }

  interface Window {
    services?: DeepReadServices
    ztools?: {
      onPluginEnter?: (callback: (action: ZToolsFeatureEnterAction) => void) => void
      onPluginOut?: (callback: (processExit: boolean) => void) => void
      showNotification?: (message: string, featureName?: string) => void
      hideMainWindow?: () => void
      outPlugin?: (isKill?: boolean) => boolean
      shellOpenExternal?: (url: string) => void
      setExpendHeight?: (height: number) => boolean
      resizeWindow?: (width: number, height: number) => boolean
      createBrowserWindow?: (url: string, options: Record<string, unknown>, callback?: () => void) => {
        id: number
        show?: () => void
        hide?: () => void
        close?: () => void
        focus?: () => void
        blur?: () => void
        isDestroyed?: () => boolean
        setFocusable?: (flag: boolean) => void
        setSkipTaskbar?: (flag: boolean) => void
        setSize?: (width: number, height: number) => void
        setContentSize?: (width: number, height: number) => void
        setContentBounds?: (bounds: { x: number; y: number; width: number; height: number }) => void
        setPosition?: (x: number, y: number) => void
        setAlwaysOnTop?: (flag: boolean) => void
        moveTop?: () => void
        webContents?: {
          executeJavaScript?: <T = unknown>(code: string, userGesture?: boolean) => Promise<T>
        }
      }
      sendToParent?: (channel: string, ...params: unknown[]) => void
      getPrimaryDisplay?: () => {
        workArea: { x: number; y: number; width: number; height: number }
        bounds: { x: number; y: number; width: number; height: number }
      }
      showOpenDialog?: (options: {
        title?: string
        buttonLabel?: string
        filters?: { name: string; extensions: string[] }[]
        properties?: string[]
      }) => string[] | undefined
      getPath?: (name: string) => string
      dbStorage?: {
        setItem?: (key: string, value: unknown) => void
        getItem?: <T = unknown>(key: string) => T
        removeItem?: (key: string) => void
      }
    }
  }
}
