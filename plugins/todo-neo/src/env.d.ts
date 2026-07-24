/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

interface TodoWindowServices {
  featureFlags?: {
    noteWindow: boolean
    tomatoWindow: boolean
  }
  openNote: (params?: { group?: string; status?: 'done' | 'pending' }) => void
  openTomato: (taskId?: string) => void
  pinToScreen: (args?: { filter?: { group?: string[]; status?: 'done' | 'pending' } }) => Promise<{ pinned: boolean }>
  closeWindow: () => void
}

declare global {
  interface Window {
    services?: TodoWindowServices
  }
}

export {}
