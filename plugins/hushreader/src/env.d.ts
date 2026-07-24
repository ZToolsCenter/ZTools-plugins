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
