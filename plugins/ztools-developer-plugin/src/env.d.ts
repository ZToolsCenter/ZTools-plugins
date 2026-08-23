/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

// Preload services 类型声明（对应 src-ztools/preload/services.js）
interface NtpSyncResult {
  /** 服务器真实时间 - 本地时间（毫秒），用于修正本地时钟偏差 */
  offset: number
  server: string
  rtt: number
}

interface Services {
  openFloatWindow: () => number | null
  closeFloatWindow: () => void
  closeSelf: () => void
  syncNtpTime: () => Promise<NtpSyncResult | null>
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
