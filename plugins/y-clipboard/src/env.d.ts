/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

// Preload services 类型声明（对应 src-ztools/preload/services.js）
interface Services {
  ready: () => boolean
  readImageDataUrl: (filePath: string) => string | null
  fileExists: (filePath: string) => boolean
  /** 在文件管理器中选中该文件；失败返回 false */
  revealInFolder: (filePath: string) => boolean
  openPath: (filePath: string) => boolean
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
