/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

declare global {
  type ImageEntry = {
    id: string
    inputPath: string
    inputBytes: number
    filename: string
    relativeName: string
    outputName: string
    resultPath: string | null
    resultBytes: number | null
    savedPercent: number | null
    error: string | null
  }

  type ImageBatch = {
    id: string
    historyId?: string
    kind: string
    createdAt: number
    phase: 'scanning' | 'pending' | 'running' | 'complete' | 'cancelled'
    cancelled: boolean
    scan?: {
      scanned: number
      found: number
    }
    error?: string
    entries: ImageEntry[]
    progress: {
      total: number
      completed: number
      succeeded: number
      failed: number
      percent: number
    }
  }

  type ImageSettings = {
    jpegQuality: number
    concurrency: number
    recursiveFolders: boolean
    ignoredFolders: string[]
  }

  type ImageRuntime = {
    addDataUris: (batch: ImageBatch, dataUris: string[]) => Promise<ImageBatch>
    cancel: (batch: ImageBatch) => ImageBatch
    copyMany: (paths: string[]) => Promise<boolean | { success: boolean; count?: number }>
    copyOne: (path: string) => boolean
    create: (request: { kind: string; payload?: unknown }, onChange?: (batch: ImageBatch) => void) => Promise<ImageBatch>
    execute: (batch: ImageBatch, onChange?: (batch: ImageBatch) => void) => Promise<ImageBatch>
    formatBytes: (bytes: number) => string
    fromHistory: (record: unknown) => ImageBatch
    getSettings: () => ImageSettings
    history: () => unknown[]
    removeHistory: (id: string) => boolean
    replaceInputs: (batch: ImageBatch) => Promise<boolean>
    replaceOne: (batch: ImageBatch, entry: ImageEntry) => Promise<boolean>
    saveSettings: (settings: ImageSettings) => ImageSettings
    toHistory: (batch: ImageBatch) => unknown
    writeHistory: (records: unknown[]) => boolean
  }

  interface Window {
    imgCompRuntime?: ImageRuntime
  }
}

export {}
