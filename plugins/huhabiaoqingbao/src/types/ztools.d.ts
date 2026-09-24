interface ZToolsPluginEnterAction {
  code: string
  type: string
  payload?: any
  option?: Record<string, any>
}

interface ZToolsApi {
  showNotification(body: string, clickFeatureCode?: string): void
  copyText(text: string): boolean
  copyFile(file: string | string[]): boolean
  hideMainWindow(isRestorePreWindow?: boolean): boolean
  showMainWindow(): boolean
  outPlugin(isKill?: boolean): boolean
  shellOpenExternal(url: string): void
  shellShowItemInFolder(path: string): void
  simulateKeyboardTap(key: string, ...modifiers: string[]): void
  getPath(name: string): string
  showOpenDialog(options: {
    title?: string
    defaultPath?: string
    buttonLabel?: string
    filters?: Array<{ name: string; extensions: string[] }>
    properties?: string[]
  }): string[] | undefined
  onPluginEnter(callback: (action: ZToolsPluginEnterAction) => void): void
  onPluginOut?(callback: (isKill: boolean) => void): void
  isDev?(): boolean
}

interface ZToolsPreload {
  fs: {
    readFile(path: string, encoding?: string): Promise<string | Uint8Array>
    writeFile(path: string, data: any): Promise<void>
    unlink(path: string): Promise<void>
    existsSync(path: string): boolean
    mkdirSync(path: string, options?: { recursive?: boolean }): void
    readFileSync(path: string, encoding?: string): string | Uint8Array
  }
  utils: {
    getDataPath(subPath: string): string
    joinPath(...paths: string[]): string
    getTempPath(fileName: string): string
  }
}

declare global {
  interface Window {
    ztools: ZToolsApi
    preload: ZToolsPreload
  }

  const ztools: ZToolsApi
}

export {}
