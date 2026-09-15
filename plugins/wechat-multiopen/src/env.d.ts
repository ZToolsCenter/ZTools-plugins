/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

interface WeChatMultiOpenConfig {
  wechatPath?: string
  count?: number
}

interface WeChatLaunchResult {
  wechatPath: string
  count: number
}

interface Services {
  findWeChatPath: () => string
  launchWeChat: (count: number, customPath?: string) => WeChatLaunchResult
  notify: (message: string) => void
  pickWeChatPath: () => string
  readConfig: () => WeChatMultiOpenConfig
  saveConfig: (config: WeChatMultiOpenConfig) => WeChatMultiOpenConfig
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
