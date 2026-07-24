/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

declare module 'visual-regex' {
  interface VisualRegexResult {
    visualCanvas: () => HTMLCanvasElement
    visualDom: (opts?: Record<string, unknown>) => HTMLElement
  }
  export default function visualRegex(regex: RegExp): VisualRegexResult
}

interface Services {
  readFile: (file: string) => string
  writeTextFile: (text: string) => string
  writeImageFile: (base64Url: string) => string | undefined
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
