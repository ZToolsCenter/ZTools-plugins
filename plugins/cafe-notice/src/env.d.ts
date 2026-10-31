/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

declare global {
  interface NoticeEntry {
    id: number
    aumid: string
    name: string
    color: string
    mode: string
    muted: boolean
    modes: string[]
    title: string
    body: string
    logo: string
    at: number
    merged?: number
    suppressBanner: boolean
  }

  interface NoticeApi {
    getStatus(): Record<string, any>
    setEnabled(on: boolean): void
    getConfig(): Record<string, string>
    getDisplays(): { id: string; label: string; primary: boolean }[]
    setConfig(patch: Record<string, string | number>): void
    collectOnce(): Promise<{ rows: number; entries: NoticeEntry[]; error: string | null }>
    getRecent(limit?: number): NoticeEntry[]
    search(keyword: string, limit?: number): NoticeEntry[]
    getApps(): Promise<(NoticeEntry & { count: number; lastAt: number })[]>
    setAppConfig(aumid: string, patch: Record<string, any>): void
    sendTestNotification(): Promise<boolean>
    setSuppressBanner(aumid: string, on: boolean): Promise<number | null>
    exportHistory(format: string, keyword?: string, aumid?: string): string
    clearHistory(): void
    helloOverlay(mode: string): void
    onMessage(fn: (entry: NoticeEntry) => void): void
    reportListHeight(height: number): void
    pingOverlay(mode: string): void
    bumpOverlays(): void
    ensureOverlays(): void
  }

  interface Services {
    notice: NoticeApi
  }

  interface Window {
    services: Services
  }
}

export {}
