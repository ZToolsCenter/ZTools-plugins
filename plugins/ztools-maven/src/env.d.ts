/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

// Preload services 类型声明（对应 preload.js）
interface Services {
  mavenSearch: (query: any) => Promise<{ data: any[]; source: string; sources?: Record<string, any[]> }>
  mavenVersions: (g: string, a: string, start?: number) => Promise<{ data: any[]; source: string }>
  codeReadVersions: (g: string, a: string) => Promise<{ data: any[]; source: string }>
  setProxy: (url: string) => boolean
  getProxy: () => string
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
