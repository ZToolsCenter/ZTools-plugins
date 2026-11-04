/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

// preload 存储层的任务数据：新格式是「任务 + rules 数组」，旧格式（1.4.x 及更早）
// 是单类型字段。渲染层统一用 migrateReminder 迁移，这里只声明边界，不做逐字段约束
type ReminderLike = Record<string, any>

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
  // 能力标记：1.5.0 起支持「任务 + 多规则」，旧版 preload 没有该字段
  supportsMultiRules?: boolean

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
