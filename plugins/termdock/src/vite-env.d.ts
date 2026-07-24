/// <reference types="vite/client" />
import type { TermdockDesktopApi } from '@termdock/core'

declare global {
  interface Window {
    termdock?: TermdockDesktopApi
  }
}

export {}
