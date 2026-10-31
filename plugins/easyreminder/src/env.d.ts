/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

interface ReminderLike {
  id: string
  title: string
  content: string
  type: string
  schedules: any[]
  interval: number
  triggerAt?: number
  weekdays?: number[]
  triggerTime?: string
  groupId?: string
  order?: number
  enabled: boolean
  lastTriggered: number
  lastFiredSlot?: number
  createdAt: number
}

interface ReminderGroupLike {
  id: string
  name: string
  createdAt: number
  order?: number
}

interface LogEntryLike {
  id: number
  time: string
  message: string
  detail: Record<string, any>
}

// Preload services 类型声明（对应 public/preload/services.js）
interface Services {
  getReminders: () => ReminderLike[]
  addReminder: (formData: Record<string, any>) => ReminderLike
  updateReminder: (id: string, formData: Record<string, any>) => boolean
  deleteReminder: (id: string) => boolean
  toggleReminder: (id: string) => boolean
  copyReminder: (id: string) => ReminderLike | null

  getGroups: () => ReminderGroupLike[]
  addGroup: (name: string) => ReminderGroupLike | null
  setGroupEnabled: (id: string, enabled: boolean) => boolean
  dissolveGroup: (id: string) => boolean
  deleteGroup: (id: string) => boolean
  assignGroup: (ids: string[], groupId: string) => boolean
  setRemindersEnabled: (ids: string[], enabled: boolean) => boolean
  deleteReminders: (ids: string[]) => boolean
  reorderGroups: (ids: string[]) => boolean
  updateReminderOrder: (items: Array<{ id: string; groupId: string | null; order: number }>) => boolean

  refreshScheduler: () => void
  getSchedulerState: () => { ready: boolean; nextTriggerText: string }

  getHolidayStatus: () => { years: number[]; updatedAt: number; refreshing: boolean }
  refreshHolidayData: () => Promise<boolean>

  getLogs: () => LogEntryLike[]
  clearLogs: () => void
}

declare global {
  interface Window {
    services: Services
    ztools: ZToolsApi
  }
}

export {}
