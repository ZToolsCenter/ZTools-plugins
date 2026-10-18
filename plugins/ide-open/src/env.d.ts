/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

interface Services {
  readProjects: (dbPath: string) => Promise<any[]>
  openProject: (command: string, uri: string, shell?: string) => Promise<void>
  deleteProject: (dbPath: string, uri: string) => Promise<void>
  getIDEs: () => any[]
  saveIDEs: (ides: any[]) => void
  registerFeatures: () => void
  getPresets: () => Record<string, any>
  getQuickFillPresets: () => any[]
  detectPresetPaths: () => Record<string, string>
  getAppDataPath: () => string
  getDefaultShell: () => string
  debugLog: (message: string, data?: any) => void
  getLogFile: () => string
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
