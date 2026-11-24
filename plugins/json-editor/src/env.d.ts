/// <reference types="vite/client" />

import type * as Monaco from 'monaco-editor'

declare global {
  interface Window {
    services?: {
      readFileContent(path: string): string
    }
    MonacoEnvironment?: Monaco.Environment
  }
}

export {}
