/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

import type { BreakRecord, ScanResult, BreakOptions } from './types'

interface Services {
  scanDirectory: (dirPath: string, recursive: boolean) => ScanResult
  breakDirectory: (dirPath: string, options: BreakOptions) => BreakRecord
  undoBreak: (record: BreakRecord) => { success: boolean; errors: string[] }
  getHistory: () => BreakRecord[]
  clearHistory: () => void
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
