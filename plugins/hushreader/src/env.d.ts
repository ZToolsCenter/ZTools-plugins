/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

interface TextFileResult {
  name: string
  path: string
  content: string
  size: number
  mtime: number
}

interface FileInfoResult {
  name: string
  path: string
  size: number
  mtime: number
}

/** HTTP 响应（含状态码与响应头，用于 Cookie 捕获 / 登录检测） */
interface HttpResponseResult {
  status: number
  text: string
  headers: Record<string, string | string[]>
}

interface Services {
  readFile: (filePath: string) => string
  readTextFile: (filePath: string) => TextFileResult
  readFileBinary: (filePath: string) => Buffer
  getFileInfo: (filePath: string) => FileInfoResult
  writeTextFile: (text: string) => string
  writeFileToPath: (filePath: string, content: string, encoding?: string) => string
  readFileFromPath: (filePath: string) => string
  writeImageFile: (imageData: any) => string
  onHushreaderCommand: (handler: (command: any) => void) => () => void
  getFileModifiedTime: (filePath: string) => number
  httpGetText: (url: string, options?: Record<string, any>) => Promise<string>
  httpPostText: (url: string, body?: string, options?: Record<string, any>) => Promise<string>
  httpGetResponse: (url: string, options?: Record<string, any>) => Promise<HttpResponseResult>
  httpPostResponse: (url: string, body?: string, options?: Record<string, any>) => Promise<HttpResponseResult>
}

interface HushreaderWindowState {
  visible: boolean
  lines: string[]
  chapter?: string
  progress?: string
  title?: string
  settings: Record<string, any>
  bounds?: { x: number; y: number; width: number; height: number }
  resizeLimits?: Record<string, number>
}

declare global {
  interface Window {
    services: Services
    hushreaderSetState: (payload: HushreaderWindowState) => void
    ztools?: any
  }
}

export { }
