/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

interface RssFetchOptions {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string | null
  timeout?: number
}

interface RssFetchResponse {
  status: number
  ok: boolean
  headers: Record<string, string>
  text: string
}

// Preload services 类型声明（对应 public/preload/services.js）
interface Services {
  rssFetch: (url: string, opts?: RssFetchOptions) => Promise<RssFetchResponse>
  fetchImageAsDataUrl: (url: string, referer?: string) => Promise<string>
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
