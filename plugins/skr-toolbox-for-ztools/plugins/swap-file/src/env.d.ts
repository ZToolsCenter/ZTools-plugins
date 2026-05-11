/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

declare global {
  // Preload services 类型声明（对应 public/preload/services.js）
  interface Services {
    readFile: (file: string) => string
    writeTextFile: (text: string) => string
    writeImageFile: (base64Url: string) => string | undefined
  }

  interface FileNode {
    id: string
    name: string
    path: string
    fullPath?: string
    size: number
    type: 'file' | 'folder'
    mtime?: number
    children?: FileNode[]
  }

  interface ServerStatus {
    running: boolean
    port: number
    lanIP: string | string[]
    accessUrl: string
  }

  interface FileShareServices {
    startServer: (port: number, sharedPaths: string[]) => Promise<ServerStatus>
    stopServer: () => Promise<void>
    getServerStatus: () => Promise<ServerStatus | null>
    getLanIP: () => Promise<string[]>
    scanDirectory: (path: string) => Promise<FileNode[]>
    matchFiles: (keyword: string) => Promise<FileNode[]>
    getUploadDir: () => string
    setUploadDir: (dir: string) => string
    openUploadDir: () => void
    getSelectedIP: () => string | null
    setSelectedIP: (ip: string) => void
    removeSelectedIP: () => void
  }

  interface Window {
    services: Services & FileShareServices
  }
}

export {}
