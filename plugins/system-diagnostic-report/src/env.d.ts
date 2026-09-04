/// <reference types="vite/client" />

import type { CollectOptions, SystemReport } from './types/report'

declare global {
  interface Window {
    systemReport?: {
      collect(options?: CollectOptions): Promise<SystemReport>
      copyText(text: string): Promise<boolean>
      saveReport(options: {
        content: string
        defaultName: string
        format: 'markdown' | 'json'
      }): Promise<{ canceled: boolean; filePath?: string }>
      startDrag?(filePath: string): Promise<boolean>
    }
    ztools?: {
      copyText?(text: string): void
      showSaveDialog?(options: unknown): Promise<{ canceled: boolean; filePath?: string }>
      getAppVersion?(): string
      getAllDisplays?(): unknown[]
      onPluginEnter?(callback: (action: unknown) => void): void
      onPluginOut?(callback: () => void): void
      startDrag?(files: string | string[]): unknown
    }
  }
}

export {}
