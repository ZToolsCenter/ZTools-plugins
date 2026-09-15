/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

interface IconServices {
  saveTextFile: (fileName: string, content: string) => string | null
  saveBase64File: (fileName: string, dataUrl: string) => string | null
}

declare global {
  interface Window {
    iconServices?: IconServices
  }
}

export {}
