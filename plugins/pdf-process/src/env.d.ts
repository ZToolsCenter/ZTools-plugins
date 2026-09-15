/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

interface Services {
  /** When outputPath is set, write to that path; otherwise use default images dir. */
  writeImageFile: (base64Url: string, outputPath?: string) => string | undefined
  createPdfFromImages: (
    imagePaths: string[],
    outputPath: string,
    options?: { pageSizes?: Array<{ widthPt: number; heightPt: number }> },
  ) => Promise<string>
  cancelCurrent: () => void
  /**
   * mode 'optimize' (default) = rewrite PDF object streams with pdf-lib.
   */
  compressPdf: (
    inputPath: string,
    outputPath: string,
    options?: { mode?: 'optimize' },
  ) => Promise<string>
  mergePdfs: (inputPaths: string[], outputPath: string) => Promise<string>
  splitPdf: (
    inputPath: string,
    outputDir: string,
    options?:
      | string
      | {
          span?: number
          beforePages?: number[]
          pageRanges?: Array<[number, number]>
          mergeRanges?: boolean
          ranges?: string
        },
  ) => Promise<string[]>
  addWatermark: (inputPath: string, outputPath: string, watermark: {
    text?: string
    image?: string
    opacity?: number
    points?: number
    rotation?: number
    position?: string
    margin?: number
    color?: string
    tile?: boolean
    density?: number
  }) => Promise<string>
  deleteFile?: (filePath: string) => boolean
  convertPdf: (inputPath: string, outputPath: string, format: 'word' | 'ppt' | 'excel') => Promise<string>
  convertPdfImages?: (
    pages: Array<{ path: string; width: number; height: number }>,
    outputPath: string,
    format: 'word' | 'ppt',
  ) => Promise<string>
  /** Resolve { feature, taskId, filename? } under downloads/pdf-*. */
  resolveTaskPath: (coords: {
    feature: string
    taskId: string
    filename?: string
  }) => string
  /** Best-effort file size for paths from the open dialog (no File handle). */
  statFile?: (filePath: string) => { size: number; mtimeMs?: number } | null
  /** Read user-selected file bytes as base64 for renderer-side PDF processing. */
  readFileBase64?: (filePath: string) => string
  /** Materialize renderer-supplied bytes under a pdf-* task directory. */
  writeFileBase64?: (base64: string, outputPath: string) => string
  /** Page count for path-only PDFs (no browser File). */
  getPdfPageCount?: (filePath: string) => Promise<number>
  getSettings: () => Promise<SettingsData | string | null>
  saveSettings: (settings: SettingsData) => Promise<void>
}

interface WebConvertLinkItem {
  name: string
  url: string
}

interface WebConvertLinksData {
  word?: WebConvertLinkItem[]
  excel?: WebConvertLinkItem[]
  ppt?: WebConvertLinkItem[]
}

interface SettingsData {
  webConvertLinks?: WebConvertLinksData
}

interface ZToolsExtended {
  getPathForFile: (file: File) => string
  showNotification: (body: string) => void
  showOpenDialog: (
    options: any,
  ) =>
    | string[]
    | undefined
    | Promise<string[] | undefined | { canceled?: boolean; filePaths?: string[] }>
  showSaveDialog: (options: any) => string | undefined
  getPath: (name: string) => string
  shellShowItemInFolder: (fullPath: string) => boolean
  shellOpenExternal: (url: string) => void
  outPlugin: (isKill?: boolean) => Promise<boolean>
  onPluginEnter: (callback: (action: any) => void) => void
  onPluginOut: (callback: (isKill: boolean) => void) => void
  dbStorage: {
    getItem: (key: string) => any
    setItem: (key: string, value: any) => void
    removeItem: (key: string) => void
  }
}

declare global {
  interface Window {
    services: Services
    ztools: ZToolsExtended
  }
}

export {}
