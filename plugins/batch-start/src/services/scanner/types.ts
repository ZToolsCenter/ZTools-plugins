import type { Platform } from '../../types'

export interface ScannedApp {
  name: string
  path: string
  platform: Platform
}

export interface PlatformScanner {
  scanSystem(): Promise<ScannedApp[]>
  scanCustomDir(dir: string): Promise<ScannedApp[]>
}
