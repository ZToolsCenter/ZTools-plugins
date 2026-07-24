/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

// Preload services 类型声明（对应 public/preload/services.js）
interface Services {
  writeTextFile: (text: string) => string
  writeImageFile: (base64Url: string) => string | undefined
  readImageFile: (filePath: string) => string
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
