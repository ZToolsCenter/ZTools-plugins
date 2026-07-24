/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

// 工作时段配置类型
interface WorkTimeSingle {
  start: string
  end: string
}

interface WorkTimeMulti {
  multi: Array<{ start: string; end: string }>
}

interface WorkTimeWeekly {
  weekly: Record<number, { start: string; end: string } | null>
}

interface WorkTimeConfig {
  single: WorkTimeSingle
  multi: Array<{ start: string; end: string }>
  weekly: Record<number, { start: string; end: string } | null>
}

// Preload services 类型声明（对应 public/preload/services.js）
interface Services {
  timerId: ReturnType<typeof setInterval> | null
  startTimer: (intervalMinutes: number) => void
  stopTimer: () => void
  isInWorkTime: (workTimeConfig: WorkTimeConfig, workTimeMode: string) => boolean
  sendNotification: (title: string, body: string, onClick?: () => void) => void
  addRecord: () => void
  getItem: <T = any>(key: string) => T | null
  setItem: (key: string, value: any) => void
  removeItem: (key: string) => void
  init: () => void
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
