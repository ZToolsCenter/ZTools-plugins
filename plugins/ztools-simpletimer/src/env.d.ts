/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

interface TimerAPI {
  createFloatingWindow: (mode: 'stopwatch' | 'countdown') => BrowserWindow.WindowInstance | null
  hideMainWindow: () => boolean
  openTimer: (mode: 'stopwatch' | 'countdown') => BrowserWindow.WindowInstance | null
  showNotification: (title: string, body?: string) => void
}

declare global {
  interface Window {
    timerAPI: TimerAPI
  }
}

export {}
