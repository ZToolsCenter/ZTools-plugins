/// <reference types="vite/client" />

import type { LanInterface, ScanResult } from './types/discovery'

declare global {
  interface Window {
    lanDiscovery?: {
      listInterfaces(): Promise<LanInterface[]>
      scan(options: {
        interfaceId: string
        resolveHostnames: boolean
        confirmRestrictedInterface: boolean
      }): Promise<ScanResult>
      cancelScan(): boolean
      copyText(text: string): Promise<boolean>
    }
    ztools?: {
      copyText?(text: string): void
      onPluginEnter?(callback: (action: unknown) => void): void
    }
  }
}

export {}
