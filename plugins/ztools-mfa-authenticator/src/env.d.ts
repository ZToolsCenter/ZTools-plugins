/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface ZToolsDB {
  put(doc: { _id: string; data: any }): void
  get(id: string): { _id: string; data: any } | undefined
  remove(id: string): void
}

interface ZToolsDBStorage {
  getItem(key: string): string | undefined
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface PluginEnterData {
  code: string
  type: string
  payload: string
}

interface ZTools {
  db: ZToolsDB
  dbStorage: ZToolsDBStorage
  copyText(text: string): boolean
  showNotification(title: string, body: string): void
  showToast(message: string): void
  hideMainWindow(): void
  resizeWindow(width: number, height: number): void
  onPluginEnter(callback: (data: PluginEnterData) => void): void
  onPluginOut(callback: () => void): void
  setSubInput(callback: (data: { text: string }) => void, placeholder: string): void
  shell: {
    openExternal(url: string): void
    openPath(path: string): void
  }
  isMacOS(): boolean
  isWindows(): boolean
}

declare global {
  interface Window {
    ztools: ZTools
  }
}

export {}
