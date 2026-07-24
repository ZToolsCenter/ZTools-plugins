/**
 * ZTools 运行时全局 API 的环境类型声明。
 * 这些 API 由 ZTools 宿主在运行时注入到 window.ztools，不在依赖包中。
 */
export {}

declare global {
  interface ZToolsDbStorage {
    getItem(key: string): any
    setItem(key: string, value: any): void
    removeItem(key: string): void
  }

  interface ZToolsDbDoc {
    _id: string
    _rev?: string
    [k: string]: any
  }

  interface ZToolsDb {
    put(doc: ZToolsDbDoc): { ok: boolean; rev?: string; id: string; error?: boolean; message?: string }
    get(id: string): ZToolsDbDoc | null
    remove(docOrId: ZToolsDbDoc | string): { ok: boolean }
    postAttachment(id: string, attachment: string | Buffer, type: string): { ok: boolean }
    getAttachment(id: string): Buffer | null
  }

  interface ZToolsClipboard {
    write: (id: string, shouldPaste?: boolean) => Promise<boolean>
    writeContent: (data: { type: 'text' | 'image'; content: string }, shouldPaste?: boolean) => Promise<boolean>
  }

  interface BrowserWindowProxy {
    show(): void
    hide(): void
    isVisible(): boolean
    isDestroyed(): boolean
    focus(): void
    close(): void
    getPosition(): [number, number]
    getSize(): [number, number]
    getBounds(): { x: number; y: number; width: number; height: number }
    setBounds(bounds: { x?: number; y?: number; width?: number; height?: number }): void
    setPosition(x: number, y: number): void
    setSize(width: number, height: number): void
    setAlwaysOnTop(flag: boolean, level?: string): void
    webContents: {
      id: number
      send(channel: string, ...args: any[]): void
      openDevTools(): void
    }
  }

  interface LaunchParam {
    payload: any
    type: 'text' | 'regex' | 'over' | 'files' | 'img'
    code: string
  }

  interface ZToolsApi {
    getAppName(): string
    isMacOs(): boolean
    isWindows(): boolean
    isLinux(): boolean
    isDarkColors(): boolean
    isDev(): boolean
    getNativeId(): string
    getAppVersion(): string
    getWindowType(): string
    setExpendHeight(height: number): void
    showNotification(body: string): void
    showMainWindow(): Promise<boolean>
    hideMainWindow(isRestorePreWindow?: boolean): Promise<boolean>
    outPlugin(isKill?: boolean): Promise<boolean>
    onPluginEnter(cb: (p: LaunchParam) => void): void
    onPluginOut(cb: (isKill: boolean) => void): void
    onPluginDetach(cb: () => void): void
    onPluginReady(cb: (p: LaunchParam) => void): void
    createBrowserWindow(
      url: string,
      options: Record<string, any>,
      callback?: () => void,
    ): BrowserWindowProxy | null
    sendToParent(channel: string, ...args: any[]): void
    showOpenDialog(options: Record<string, any>): string[] | undefined
    showSaveDialog(options: Record<string, any>): string | undefined
    screenCapture(cb: (image: string) => void): void
    copyText(text: string): boolean
    getPath(name: string): string
    getPathForFile(file: File): string
    db: ZToolsDb
    dbStorage: ZToolsDbStorage
    clipboard: ZToolsClipboard
  }

  const ztools: ZToolsApi | undefined

  interface Window {
    ztools?: ZToolsApi
    /**
     * 主窗 preload 暴露给渲染进程的服务。
     * 阅读窗有自己的 reader services，详见 preload/reader.js。
     */
    services?: ReaderServices
    _ipcRenderer?: { on(channel: string, cb: (e: unknown, ...args: any[]) => void): void; send(channel: string, ...args: any[]): void }
    _sendToParent?: (channel: string, data?: any) => void
  }

  /** preload 暴露的文件读取/解析服务 */
  interface ReaderServices {
    /** 读取 TXT 文件，自动检测编码并解码为字符串 */
    readTxt(filePath: string): string | null
    /** 解析 EPUB，返回书籍元信息 + 章节列表（正文为 HTML 字符串） */
    readEpub(filePath: string): EBook | null
    /** 读取 PDF 为 ArrayBuffer，交由前端 pdfjs 渲染 */
    readPdf(filePath: string): ArrayBuffer | null
    /** 取文件 Buffer（封面等） */
    readBuffer(filePath: string): ArrayBuffer | null
    /** 选择文件对话框 */
    showOpenDialog(options: Record<string, any>): string[] | undefined
    /** 创建并持有悬浮阅读窗 */
    createReaderWindow(state: any): BrowserWindowProxy | null
    /** 向阅读窗发送消息 */
    sendToReader(channel: string, data?: any): void
    /** 显示阅读窗 */
    showReader(): boolean
    /** 切换阅读窗显隐 */
    toggleReader(): boolean
  }

  /** EPUB 解析结果（readEpub 返回） */
  interface EBook {
    title: string
    filePath: string
    format: 'epub'
    chapters: { title: string; content: string; index: number }[]
    totalChapters: number
    cover?: ArrayBuffer | null
  }
}