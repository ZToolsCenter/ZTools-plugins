// 全局类型定义

export type RecentKind = 'folder' | 'workspace' | 'remote'

export interface RecentItem {
  id: string
  kind: RecentKind
  title: string
  subtitle: string
  rawPath: string
  exists: boolean
}

export interface VSCodeConfig {
  codeExecutable: string
  vscdbPath: string
  workspaceStorageRoot: string
  storageJsonPath: string
}

declare global {
  interface Window {
    services: {
      readFile(file: string): string
      writeTextFile(text: string): string
      writeImageFile(base64Url: string): string | undefined
vscodeRecent: {
        platform: NodeJS.Platform
        list(): Promise<RecentItem[]>
        diagnose(): Promise<{ items: RecentItem[]; diag: any }>
        openProject(item: RecentItem): boolean
      }
      getVSCodeConfig(): VSCodeConfig
      saveVSCodeConfig(config: VSCodeConfig): void
    }
    Fuse: any
    ztools: any
  }
}

export {}
