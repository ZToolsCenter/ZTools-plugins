/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

// Preload 暴露的唤醒控制能力（对应 src-ztools/preload/services.js）
import type { AwakeBridge } from './awake-types'

declare global {
  interface Window {
    /** 仅在 preload 成功注入时存在，开发预览中可能为 undefined。 */
    awakeBridge?: AwakeBridge
  }
}

export {}
