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
  enabled: boolean
  lastTriggered: number
  createdAt: number
}

interface LogEntryLike {
  id: number
  time: string
  message: string
  detail: Record<string, any>
}

// Preload services 类型声明（对应 public/preload/services.js）
interface Services {
  readFile: (file: string) => string
  writeTextFile: (text: string) => string
  writeImageFile: (base64Url: string) => string | undefined
  notify: (title: string, body: string) => void
  sendNotification: (title: string, body: string) => void

  getReminders: () => ReminderLike[]
  addReminder: (formData: Record<string, any>) => ReminderLike
  updateReminder: (id: string, formData: Record<string, any>) => boolean
  deleteReminder: (id: string) => boolean
  toggleReminder: (id: string) => boolean

  refreshScheduler: () => void
  stopScheduler: () => void

  getLogs: () => LogEntryLike[]
  addLog: (message: string, detail: Record<string, any>) => void
  clearLogs: () => void
}

declare global {
  interface Window {
    services: Services
    ztools: ZToolsApi
  }
}

export {}
