/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

interface EasyTableServices {
  loadMeta: () => import('./types/table').AppMeta
  saveMeta: (meta: import('./types/table').AppMeta) => import('./types/table').AppMeta
  listRows: (tableId: string) => import('./types/table').Row[]
  putRow: (row: import('./types/table').Row) => import('./types/table').Row
  deleteRow: (tableId: string, rowId: string) => boolean
  replaceTableRows: (tableId: string, rows: import('./types/table').Row[]) => number
  deleteTableRows: (tableId: string) => boolean
  generateId: (prefix?: string) => string
  writeTextFile: (filePath: string | undefined, text: string) => string
  readFile: (filePath: string) => string
  pickSavePath: (options?: unknown) => string | undefined
  pickOpenPath: (options?: unknown) => string[] | undefined
}

declare global {
  interface Window {
    services: EasyTableServices
  }
}

export {}
