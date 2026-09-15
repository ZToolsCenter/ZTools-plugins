/// <reference types="vite/client" />

import type { ApplicationUninstallerBridge } from './types'

declare global {
  interface Window { applicationUninstaller?: ApplicationUninstallerBridge }
}

export {}
