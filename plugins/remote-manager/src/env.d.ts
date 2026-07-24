/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

// Preload services 类型声明（对应 public/preload/services.js）
interface RemoteHost {
  id: string
  address: string
  username: string
  password: string
}

interface Services {
  readFile: (file: string) => string
  writeTextFile: (text: string) => string
  writeImageFile: (base64Url: string) => string | undefined
  getHosts: () => RemoteHost[]
  addHost: (host: RemoteHost) => { success: boolean; error?: string }
  updateHost: (originalId: string, host: RemoteHost) => { success: boolean; error?: string }
  deleteHost: (id: string) => { success: boolean; error?: string }
  connectRdp: (address: string, username: string, password: string) => { success: boolean; error?: string }
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
