/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

// Preload 注入的服务（对应 src-ztools/preload/services.js）
// 目前是空的：x-clipboard 只用宿主注入的 window.ztools.*，不需要额外 node 能力。
interface Services {}

declare global {
  interface Window {
    services: Services
  }
}

export {}
