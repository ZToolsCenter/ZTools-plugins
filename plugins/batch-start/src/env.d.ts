/// <reference types="vite/client" />

import type {
  AppDoc,
  CategoryDoc,
  GroupDoc,
  LaunchResult,
  SettingsDoc,
} from './types'

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

export type GroupInput = {
  name: string
  cmds: string[]
  appIds: string[]
  order: number
}

export interface BatchStartApi {
  listApps: () => Promise<AppDoc[]>
  listCategories: () => Promise<CategoryDoc[]>
  listGroups: () => Promise<GroupDoc[]>
  getSettings: () => Promise<SettingsDoc>
  createCategory: (name: string) => Promise<CategoryDoc>
  renameCategory: (id: string, name: string) => Promise<CategoryDoc>
  deleteCategory: (id: string) => Promise<void>
  assignCategory: (appId: string, categoryId: string | null) => Promise<AppDoc>
  addManualApp: () => Promise<AppDoc | null>
  addCustomScanDir: () => Promise<SettingsDoc | null>
  removeCustomScanDir: (dir: string) => Promise<SettingsDoc>
  runScan: () => Promise<AppDoc[]>
  saveGroup: (input: GroupInput, id?: string) => Promise<GroupDoc>
  deleteGroup: (groupId: string) => Promise<void>
  retrySyncGroup: (groupId: string) => Promise<GroupDoc | null>
  reconcileFeatures: () => Promise<void>
  launchGroup: (groupId: string) => Promise<LaunchResult>
}

declare global {
  interface Window {
    batchStart: BatchStartApi
    ztools?: {
      showToast?: (message: string, options?: Record<string, unknown>) => unknown
      setExpendHeight?: (height: number) => void
    }
  }
}

export {}
