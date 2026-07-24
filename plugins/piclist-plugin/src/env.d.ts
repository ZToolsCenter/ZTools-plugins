/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

interface PicListConfig {
  host: string
  port: string
  apiKey: string
  useHttps: boolean
}

interface UploadResult {
  success: boolean
  url?: string
  message: string
}

interface Services {
  readFile: (file: string) => string
  writeTextFile: (text: string) => string
  writeImageFile: (base64Url: string) => string | undefined
  downloadFile: (url: string, options: { savePath?: string; onProgress?: (progress: number) => void }) => Promise<string>
  batchSaveMarkdownFiles: (files: Array<{ filename: string; content: string }>) => { results: Array<{ success: boolean; path?: string; error?: string; originalName?: string }>; baseDir: string }
  readDirectoryFiles: (dirPath: string) => Array<{ path: string; relativePath: string; name: string; size: number; mtime: Date }>
  fileExists: (filePath: string) => boolean
  getFileInfo: (filePath: string) => { exists: boolean; size?: number; mtime?: Date; isDirectory?: boolean; isFile?: boolean; error?: string }
  uploadToPicList: (file: File, config: PicListConfig) => Promise<UploadResult>
}

declare global {
  interface Window {
    services: Services
    ztools: ZToolsApi & {
      getStorage?: (key: string) => Promise<string | null>
      setStorage?: (key: string, value: string) => Promise<boolean>
    }
  }
  
  interface ZToolsApi {
    getTheme?: () => string
    onThemeChange?: (callback: (theme: string) => void) => void
    onPluginEnter?: (callback: (param: { code?: string; payload?: string }) => void) => void
    isDarkColors?: () => boolean
    getPath?: (pathName: string) => string
  }
}

export {}