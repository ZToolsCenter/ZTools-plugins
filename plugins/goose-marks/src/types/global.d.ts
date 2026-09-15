interface UToolsBrowserWindow {
  show(): void
  webContents?: {
    executeJavaScript(code: string): Promise<unknown>
    send(channel: string, ...args: unknown[]): void
  }
}

interface UBrowserApi {
  goto(url: string, headers?: Record<string, string>, timeout?: number): UBrowserApi
  run(options?: { width?: number; height?: number; show?: boolean }): Promise<unknown[]>
}

interface UToolsAiModel {
  id: string
  label: string
  description?: string
  icon?: string
  cost?: string
}

interface UToolsAiOption {
  model?: string
  messages: UToolsAiMessage[]
}

interface UToolsAiMessage {
  role: 'system' | 'user' | 'assistant'
  content?: string
  reasoning_content?: string
}

interface UToolsUserInfo {
  avatar: string
  nickname: string
  type: 'member' | 'user'
}

interface UToolsToolContext {
  requestId: string | number
  sendProgress?: (options: {
    progress: number
    total?: number
    message?: string
  }) => Promise<void>
}

interface GooseMarksWindowPosition {
  x: number
  y: number
}

interface GooseMarksWindowControl {
  getPosition?: () => GooseMarksWindowPosition | null
  setPosition?: (position: GooseMarksWindowPosition) => boolean
}

interface UToolsApi {
  isWindows?(): boolean
  dbStorage?: {
    getItem: (key: string) => unknown
    setItem: (key: string, value: string) => void
    removeItem: (key: string) => void
  }
  db?: {
    put: <T>(doc: { _id: string; _rev?: string; data: T }) => { ok?: boolean; id?: string; rev?: string; error?: unknown; message?: string }
    get: <T>(id: string) => { _id: string; _rev?: string; data: T } | null
    remove: (id: string) => { ok?: boolean; id?: string; error?: unknown; message?: string }
    allDocs: <T>(prefix?: string) => Array<{ _id: string; _rev?: string; data: T }>
    postAttachment?: (id: string, data: Uint8Array, type: string) => { ok?: boolean; id?: string; rev?: string; error?: unknown; message?: string }
    getAttachment?: (id: string) => Uint8Array | null
    getAttachmentType?: (id: string) => string | null
  }
  getPath(name: string): string
  setSubInput(onChange: (params: { text: string }) => void, placeholder?: string, isFocus?: boolean): boolean
  setSubInputValue?(text: string): boolean
  subInputFocus?(): void
  removeSubInput(): boolean
  registerTool?(name: string, handler: (params: Record<string, unknown>, ctx: UToolsToolContext) => unknown | Promise<unknown>): void
  onPluginEnter(callback: (params: {
    code: string
    type: 'text' | 'img' | 'file' | 'regex' | 'over' | 'window'
    payload: any
    from: 'main' | 'panel' | 'hotkey' | 'reirect'
    option?: {
      mainPush: boolean
    }
  }) => void): void
  shellOpenExternal(url: string): void
  setFeature?(feature: {
    code: string
    explain: string
    cmds: Array<string | Record<string, unknown>>
    mainHide?: boolean
    mainPush?: boolean
  }): void
  getFeatures?(): Array<{ code: string; explain?: string; cmds?: unknown[]; mainHide?: boolean; mainPush?: boolean }>
  removeFeature?(code: string): boolean
  // uTools AI API - 需要用户在 uTools 中配置 AI 服务
  ai?(option: UToolsAiOption, streamCallback?: (chunk: { text?: string; content?: string }) => void): Promise<string | { text?: string; content?: string }>
  allAiModels?(): Promise<UToolsAiModel[]>
  isDarkColors?(): boolean
  getWindowType?(): 'main' | 'detach' | 'browser'
  outPlugin(isKill?: boolean): boolean
  createBrowserWindow?(url: string, options?: Record<string, unknown>, callback?: () => void): UToolsBrowserWindow | undefined
  ubrowser?: UBrowserApi
  getVersion?(): string
  getUser?(): UToolsUserInfo | null
  copyText?(text: string): void
  setExpendHeight?(height: number): void
  showNotification?(text: string): void
  hideMainWindow?(): void
  // 文件对话框 API
  showOpenDialog?(options: {
    title?: string
    filters?: Array<{ name: string; extensions: string[] }>
    properties?: ('openFile' | 'openDirectory' | 'multiSelections')[]
  }): Promise<string[] | undefined>
  readFileSync?(path: string, encoding: 'utf-8'): string | undefined
}

declare global {
  interface Window {
    utools?: UToolsApi
    gooseWeb?: {
      fetchText: (
        url: string,
        options?: { timeoutMs?: number; maxBytes?: number; maxDecodedBytes?: number }
      ) => Promise<{
        ok: true
        url: string
        status: number
        contentType: string
        text: string
      }>
      fetchBinary: (
        url: string,
        options?: { timeoutMs?: number; maxBytes?: number; maxDecodedBytes?: number }
      ) => Promise<{
        ok: true
        url: string
        status: number
        contentType: string
        base64: string
      }>
      getProxy: () => string | null
    }
    __gooseMarksWindowControl?: GooseMarksWindowControl
    require?: NodeRequire
    __gooseMarksPluginEnterSerial?: number
    __gooseMarksLastPluginEnterSerial?: number
    __gooseMarksLastHandledPluginEnterSerial?: number
    __gooseMarksPendingPluginEnterEvents?: Array<{
      serial: number
      params: {
        code?: string
        type?: 'text' | 'img' | 'file' | 'regex' | 'over' | 'window'
        payload?: unknown
        from?: 'main' | 'panel' | 'hotkey' | 'reirect'
        option?: {
          mainPush: boolean
        }
        [key: string]: unknown
      }
    }>
    __gooseMarksLastPluginEnterParams?: {
      code?: string
      type?: 'text' | 'img' | 'file' | 'regex' | 'over' | 'window'
      payload?: unknown
      from?: 'main' | 'panel' | 'hotkey' | 'reirect'
      option?: {
        mainPush: boolean
      }
      [key: string]: unknown
    } | null
  }
}

export {}
