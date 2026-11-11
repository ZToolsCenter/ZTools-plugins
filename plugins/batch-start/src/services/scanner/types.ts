import type { AppSource, Platform } from '../../types'

export interface ScannedApp {
  name: string
  path: string
  platform: Platform
  icon?: string | null
  source?: AppSource
  pluginName?: string
  pluginTitle?: string
  launchCmd?: string | null
  /** When set, used as makeAppId(...) for stable ids */
  stableIdHint?: string
}

export interface PlatformScanner {
  scanSystem(): Promise<ScannedApp[]>
  scanCustomDir(dir: string): Promise<ScannedApp[]>
}
