/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

declare global {
  interface AutomationServices {
    vmRunScript(code: string, enter: unknown, print: (msg: unknown) => void): Promise<unknown>
    getInsetScript(name: string): string | null
    readImageDataUrl(filePath: string): string | null
  }

  interface Window {
    services: AutomationServices
    platform: string
  }
}

export {}
