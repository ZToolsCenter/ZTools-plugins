export type ReminderType = 'interval' | 'once' | 'daily'

export interface DaySchedule {
  weekday: number   // 0-6，周日到周六
  startTime: string // "09:00"
  endTime: string   // "18:00"
}

export interface Reminder {
  id: string
  title: string
  content: string
  type: ReminderType
  // interval 类型：时间段 + 间隔
  schedules: DaySchedule[]
  interval: number
  // once 类型：一次性定时提醒，触发时间戳
  triggerAt?: number
  // daily 类型：每日定点提醒
  weekdays?: number[]
  triggerTime?: string // "14:30"
  // 通用
  enabled: boolean
  lastTriggered: number
  createdAt: number
}

export interface ReminderFormData {
  title: string
  content: string
  type: ReminderType
  schedules: DaySchedule[]
  interval: number
  triggerAt?: number
  weekdays?: number[]
  triggerTime?: string
}

export const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

export const REMINDER_TYPE_LABELS: Record<ReminderType, string> = {
  interval: '间隔提醒',
  once: '定时提醒',
  daily: '每日提醒'
}

export function createEmptyReminder(): ReminderFormData {
  return {
    title: '',
    content: '',
    type: 'interval',
    schedules: [],
    interval: 60,
    triggerAt: undefined,
    weekdays: [],
    triggerTime: '09:00'
  }
}

/**
 * 迁移旧数据格式 → 新格式
 */
export function migrateReminder(raw: any): Reminder {
  if (raw.type) {
    // 已经是新格式
    return raw as Reminder
  }
  // 旧格式：schedules 格式（无 type 字段）
  if (Array.isArray(raw.schedules)) {
    return {
      ...raw,
      type: 'interval',
      weekdays: undefined,
      triggerTime: undefined,
      triggerAt: undefined
    } as Reminder
  }
  // 最旧格式：weekdays + startTime + endTime
  const weekdays: number[] = raw.weekdays || []
  const startTime: string = raw.startTime || '09:00'
  const endTime: string = raw.endTime || '18:00'
  return {
    id: raw.id,
    title: raw.title,
    content: raw.content || '',
    type: 'interval',
    schedules: weekdays.map(w => ({ weekday: w, startTime, endTime })),
    interval: raw.interval || 60,
    enabled: raw.enabled ?? true,
    lastTriggered: raw.lastTriggered || 0,
    createdAt: raw.createdAt || Date.now()
  }
}
