/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

interface FileInfo {
  path: string
  name: string
  ext: string
  fullName: string
  dir: string
  size: number
  createTime: Date
  modifyTime: Date
}

interface RenameRule {
  prefix?: string
  suffix?: string
  replace?: {
    from: string
    to: string
  } | null
  number?: {
    start: number
    digits: number
  } | null
}

interface PreviewResult {
  oldName: string
  newName: string
  path: string
  error?: string
}

interface RenameResult {
  success: boolean
  oldPath: string
  newPath?: string
  newName?: string
  error?: string
}

interface Services {
  readFile: (file: string) => string
  writeTextFile: (text: string) => string
  writeImageFile: (base64Url: string) => string | undefined
  getFileInfo: (filePath: string) => FileInfo
  renameFile: (oldPath: string, newName: string) => string
  copyFile: (oldPath: string, newName: string) => string
  batchRename: (files: string[], rule: RenameRule, copyMode?: boolean) => RenameResult[]
  previewRename: (files: string[], rule: RenameRule) => PreviewResult[]
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
