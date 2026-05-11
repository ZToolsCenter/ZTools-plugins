/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

declare module 'figlet' {
  const figlet: {
    parseFont(name: string, data: string): void
    textSync(text: string, options?: string | {
      font?: string
      horizontalLayout?: 'default' | 'full' | 'fitted' | 'controlled smushing' | 'universal smushing'
      verticalLayout?: 'default' | 'full' | 'fitted' | 'controlled smushing' | 'universal smushing'
      width?: number
      whitespaceBreak?: boolean
    }): string
    fontsSync(): string[]
  }
  export default figlet
}

declare module 'figlet/importable-fonts/*' {
  const font: string
  export default font
}

interface Services {}

declare global {
  interface Window {
    services: Services
  }
}

export {}
