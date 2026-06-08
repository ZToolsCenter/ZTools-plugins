/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

declare global {
  interface OpenListConfig {
    baseUrl: string
    username: string
    token: string
  }

  interface OpenListFile {
    name: string
    size: number
    is_dir: boolean
    modified?: string
    sign?: string
    thumb?: string
    type?: number
    raw_url?: string
  }

  interface OpenListListResult {
    content: OpenListFile[] | null
    total: number
    readme?: string
    write?: boolean
  }

  interface Services {
    loadOpenListConfig: () => OpenListConfig
    saveOpenListConfig: (config: Partial<OpenListConfig>) => OpenListConfig
    clearOpenListConfig: () => OpenListConfig
    loginOpenList: (baseUrl: string, username: string, password: string) => Promise<OpenListConfig>
    listOpenList: (
      baseUrl: string,
      token: string,
      dirPath: string,
      password?: string,
      refresh?: boolean
    ) => Promise<OpenListListResult>
    getOpenListFile: (
      baseUrl: string,
      token: string,
      filePath: string,
      password?: string
    ) => Promise<OpenListFile | null>
    listOpenListDirs: (
      baseUrl: string,
      token: string,
      dirPath?: string,
      password?: string,
      forceRoot?: boolean
    ) => Promise<Array<{ name: string; path: string }>>
    makeOpenListDir: (
      baseUrl: string,
      token: string,
      dirPath: string,
      name: string
    ) => Promise<unknown>
    renameOpenListFile: (
      baseUrl: string,
      token: string,
      filePath: string,
      name: string
    ) => Promise<unknown>
    moveOpenListFiles: (
      baseUrl: string,
      token: string,
      srcDir: string,
      dstDir: string,
      names: string[]
    ) => Promise<unknown>
    copyOpenListFiles: (
      baseUrl: string,
      token: string,
      srcDir: string,
      dstDir: string,
      names: string[]
    ) => Promise<unknown>
    removeOpenListFiles: (
      baseUrl: string,
      token: string,
      dirPath: string,
      names: string[]
    ) => Promise<unknown>
    downloadOpenListFile: (
      baseUrl: string,
      token: string,
      fileUrl: string,
      savePath: string,
      onProgress?: (progress: { loaded: number; total: number; percent: number }) => void,
      knownSize?: number
    ) => Promise<string>
    downloadOpenListDir: (
      baseUrl: string,
      token: string,
      remoteDir: string,
      localParentDir: string,
      onProgress?: (progress: { loaded: number; total: number; percent: number }) => void
    ) => Promise<string>
    downloadOpenListItems: (
      baseUrl: string,
      token: string,
      srcDir: string,
      names: string[],
      localParentDir: string,
      onProgress?: (progress: { loaded: number; total: number; percent: number }) => void
    ) => Promise<string>
    uploadOpenListFile: (
      baseUrl: string,
      token: string,
      remoteDir: string,
      localFilePath: string,
      onProgress?: (progress: { loaded: number; total: number; percent: number }) => void
    ) => Promise<unknown>
    uploadOpenListFileContent: (
      baseUrl: string,
      token: string,
      remoteDir: string,
      fileName: string,
      arrayBuffer: ArrayBuffer,
      onProgress?: (progress: { loaded: number; total: number; percent: number }) => void
    ) => Promise<unknown>
  }

  interface Window {
    services: Services
  }
}

export {}
