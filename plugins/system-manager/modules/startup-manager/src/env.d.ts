/// <reference types="vite/client" />

import type { StartupBridge } from './types/startup'

declare global {
  interface Window { startupManager?: StartupBridge }
}

export {}
