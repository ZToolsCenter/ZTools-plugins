export type Platform = 'win32' | 'darwin' | 'linux'
/** `ztools` = a divertible ZTools text command (not a desktop app) */
export type AppSource = 'scan' | 'manual' | 'ztools' | 'plugin'

export interface AppDoc {
  _id: string
  _rev?: string
  name: string
  path: string
  icon?: string | null
  source: AppSource
  categoryId: string | null
  platform: Platform
  /** Present when source is ztools (or legacy plugin) */
  pluginName?: string
  pluginTitle?: string
  /** Divertible text cmd used with ztools.redirect */
  launchCmd?: string | null
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
