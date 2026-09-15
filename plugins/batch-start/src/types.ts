export type Platform = 'win32' | 'darwin' | 'linux'
export type AppSource = 'scan' | 'manual'

export interface AppDoc {
  _id: string
  _rev?: string
  name: string
  path: string
  icon?: string | null
  source: AppSource
  categoryId: string | null
  platform: Platform
}

export interface CategoryDoc {
  _id: string
  _rev?: string
  name: string
  order: number
}

export interface GroupDoc {
  _id: string
  _rev?: string
  name: string
  cmds: string[]
  appIds: string[]
  order: number
  featureSynced: boolean
}

export interface SettingsDoc {
  _id: 'settings'
  _rev?: string
  customScanDirs: string[]
  lastScanAt: number | null
}

export interface LaunchResult {
  success: number
  failed: number
  errors: Array<{ path: string; error: string }>
}
