export type ReminderType = 'interval' | 'once' | 'daily'

// 触发日过滤：all=不限，workday=仅法定工作日，holiday=仅法定节假日
export type DayFilter = 'all' | 'workday' | 'holiday'

// 间隔提醒触发对齐：start=对齐时间段起点（startTime + N×间隔），create=从上次触发/创建时刻起算
export type AlignMode = 'start' | 'create'

export interface DaySchedule {
  weekday: number   // 0-6，周日到周六
  startTime: string // "09:00"
  endTime: string   // "18:00"
}

export interface ReminderGroup {
  id: string
  name: string
  createdAt: number
  order?: number
}

// 每条规则共有：id 用于日志与表单定位，lastTriggered 供「随创建时间」对齐使用
interface RuleBase {
  id: string
  enabled: boolean
  createdAt: number
  lastTriggered?: number
}

export interface OnceRule extends RuleBase {
  type: 'once'
  triggerAt: number
  firedAt?: number // 已触发时刻；有值即视为已消费，不再触发
}

export interface DailyRule extends RuleBase {
  type: 'daily'
  weekdays: number[]
  triggerTime: string
  dayFilter: DayFilter
}

export interface IntervalRule extends RuleBase {
  type: 'interval'
  schedules: DaySchedule[]
  interval: number
  align: AlignMode
  dayFilter: DayFilter
}

export type TriggerRule = OnceRule | DailyRule | IntervalRule

export interface Reminder {
  id: string
  title: string
  content: string
  // 同一任务的多条调度规则，各自独立生效，任意一条到点即提醒一次
  rules: TriggerRule[]
  // 所属分组（缺省为未分组）
  groupId?: string
  // 组内/未分组内的拖拽排序值，越大越靠前
  order?: number
  // 任务总开关：关闭后所有规则都不触发
  enabled: boolean
  lastTriggered: number
  // 最近一次已触发过的计划时刻（时间戳，用于同一时刻去重）
  lastFiredSlot?: number
  createdAt: number
}

export interface ReminderFormData {
  title: string
  content: string
  rules: TriggerRule[]
  groupId?: string
}

export const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

export const REMINDER_TYPE_LABELS: Record<ReminderType, string> = {
  interval: '间隔提醒',
  once: '定时提醒',
  daily: '每日提醒'
}

export const DAY_FILTER_LABELS: Record<DayFilter, string> = {
  all: '不限',
  workday: '仅工作日',
  holiday: '仅节假日'
}

function generateRuleId(): string {
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

// 新建一条空规则（表单「添加规则」与空表单默认值共用）
export function createRule(type: ReminderType = 'daily'): TriggerRule {
  const base = { id: generateRuleId(), enabled: true, createdAt: Date.now() }
  if (type === 'once') {
    return { ...base, type: 'once', triggerAt: Date.now() + 60 * 60 * 1000 }
  }
  if (type === 'daily') {
    return { ...base, type: 'daily', weekdays: [0, 1, 2, 3, 4, 5, 6], triggerTime: '09:00', dayFilter: 'all' }
  }
  return { ...base, type: 'interval', schedules: [], interval: 60, align: 'start', dayFilter: 'all' }
}

function normalizeRule(raw: any, fallbackId: string, fallbackCreatedAt: number): TriggerRule | null {
  if (!raw || typeof raw !== 'object') return null
  const base = {
    id: raw.id || fallbackId,
    enabled: raw.enabled ?? true,
    createdAt: raw.createdAt || fallbackCreatedAt,
    lastTriggered: typeof raw.lastTriggered === 'number' ? raw.lastTriggered : undefined
  }
  if (raw.type === 'once') {
    return {
      ...base,
      type: 'once',
      triggerAt: Number(raw.triggerAt) || 0,
      firedAt: typeof raw.firedAt === 'number' ? raw.firedAt : undefined
    }
  }
  if (raw.type === 'daily') {
    return {
      ...base,
      type: 'daily',
      weekdays: Array.isArray(raw.weekdays) ? raw.weekdays.filter((d: any) => Number.isInteger(d) && d >= 0 && d <= 6) : [],
      triggerTime: raw.triggerTime || '09:00',
      dayFilter: raw.dayFilter || 'all'
    }
  }
  if (raw.type === 'interval') {
    return {
      ...base,
      type: 'interval',
      schedules: Array.isArray(raw.schedules)
        ? raw.schedules.map((s: any) => ({ weekday: s.weekday, startTime: s.startTime, endTime: s.endTime }))
        : [],
      interval: Number(raw.interval) || 60,
      align: raw.align === 'start' ? 'start' : 'create',
      dayFilter: raw.dayFilter || 'all'
    }
  }
  return null
}

/**
 * 迁移旧数据格式 → 新格式（单类型提醒 → 单规则任务）
 */
export function migrateReminder(raw: any): Reminder {
  const createdAt = raw.createdAt || Date.now()
  const rules: TriggerRule[] = []
  let enabled = raw.enabled ?? true

  // 只要带 rules 字段就按新格式解析：rules: [] 表示任务没有规则，
  // 不能退回旧字段反推（否则会凭空造出预载调度里并不存在的规则）
  const hasRules = Array.isArray(raw.rules)
  if (hasRules) {
    raw.rules.forEach((rule: any, i: number) => {
      const normalized = normalizeRule(rule, `${raw.id}-r${i + 1}`, createdAt)
      if (normalized) rules.push(normalized)
    })
  } else if (raw.type === 'once') {
    // 旧版一次性提醒触发后会把整条提醒停用，这里还原为任务级启用（由规则的 firedAt 表示已消费）
    const firedAt = raw.lastTriggered > 0 ? raw.lastTriggered : undefined
    if (firedAt) enabled = true
    rules.push({
      id: `${raw.id}-r1`,
      type: 'once',
      enabled: true,
      createdAt,
      lastTriggered: raw.lastTriggered || undefined,
      triggerAt: raw.triggerAt || 0,
      firedAt
    })
  } else if (raw.type === 'daily') {
    rules.push({
      id: `${raw.id}-r1`,
      type: 'daily',
      enabled: true,
      createdAt,
      lastTriggered: raw.lastTriggered || undefined,
      weekdays: Array.isArray(raw.weekdays) ? raw.weekdays.filter((d: any) => Number.isInteger(d) && d >= 0 && d <= 6) : [],
      triggerTime: raw.triggerTime || '09:00',
      dayFilter: raw.dayFilter || 'all'
    })
  } else if (raw.type === 'interval' || Array.isArray(raw.schedules) || Array.isArray(raw.weekdays)) {
    // 含最旧格式（weekdays + startTime + endTime，无 schedules）
    const schedules: DaySchedule[] = Array.isArray(raw.schedules)
      ? raw.schedules.map((s: any) => ({ weekday: s.weekday, startTime: s.startTime, endTime: s.endTime }))
      : (raw.weekdays || []).map((w: number) => ({
          weekday: w,
          startTime: raw.startTime || '09:00',
          endTime: raw.endTime || '18:00'
        }))
    rules.push({
      id: `${raw.id}-r1`,
      type: 'interval',
      enabled: true,
      createdAt,
      lastTriggered: raw.lastTriggered || undefined,
      schedules,
      interval: raw.interval || 60,
      align: raw.align === 'start' ? 'start' : 'create',
      dayFilter: raw.dayFilter || 'all'
    })
  }

  if (!hasRules && !rules.length) rules.push(createRule('interval'))

  return {
    id: raw.id,
    title: raw.title,
    content: raw.content || '',
    rules,
    groupId: raw.groupId || undefined,
    order: raw.order,
    enabled,
    lastTriggered: raw.lastTriggered || 0,
    lastFiredSlot: raw.lastFiredSlot || 0,
    createdAt
  }
}

// ==================== 展示格式 ====================

// 星期压缩：连续 3 天以上合并成区间（周一~周四），全选显示「每天」
export function formatWeekdays(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b)
  if (sorted.length === 7) return '每天'
  const parts: string[] = []
  let i = 0
  while (i < sorted.length) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    if (j - i >= 2) {
      parts.push(`周${WEEKDAY_LABELS[sorted[i]]}~周${WEEKDAY_LABELS[sorted[j]]}`)
    } else {
      parts.push(sorted.slice(i, j + 1).map(d => `周${WEEKDAY_LABELS[d]}`).join('、'))
    }
    i = j + 1
  }
  return parts.join('、')
}

function formatIntervalMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}分钟`
  const h = minutes / 60
  return Number.isInteger(h) ? `${h}小时` : `${minutes}分钟`
}

function formatOnceTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 时段 + 星期组合的展示：全部星期共用同一时段时只写一次星期；
// 各星期时段不同时按「星期 时段」逐组列出
function formatIntervalSchedules(schedules: DaySchedule[]): string {
  const allDays = [...new Set(schedules.map(s => s.weekday))].sort((a, b) => a - b)
  const map = new Map<string, number[]>()
  for (const s of [...schedules].sort((a, b) => a.weekday - b.weekday)) {
    const key = `${s.startTime}-${s.endTime}`
    if (!map.has(key)) map.set(key, [])
    if (!map.get(key)!.includes(s.weekday)) map.get(key)!.push(s.weekday)
  }
  if (map.size === 1) return `${formatWeekdays(allDays)} ${[...map.keys()][0]}`
  return [...map.entries()]
    .map(([range, days]) => `${formatWeekdays(days.sort((a, b) => a - b))} ${range}`)
    .join('、')
}

// 单条规则的人类可读摘要（列表项、表单折叠态共用）
export function describeRule(rule: TriggerRule): string {
  const filterPrefix = rule.type !== 'once' && rule.dayFilter && rule.dayFilter !== 'all'
    ? (rule.dayFilter === 'workday' ? '工作日 ' : '节假日 ')
    : ''

  if (rule.type === 'once') {
    return `定时 ${formatOnceTime(rule.triggerAt)}`
  }
  if (rule.type === 'daily') {
    if (!rule.weekdays.length) return `${filterPrefix}未选择星期`
    return `${filterPrefix}${formatWeekdays(rule.weekdays)} ${rule.triggerTime}`
  }
  if (!rule.schedules.length) return `${filterPrefix}未配置时间段`
  const align = rule.align === 'create' ? ' · 随创建时间' : ''
  return `${filterPrefix}${formatIntervalSchedules(rule.schedules)} 每${formatIntervalMinutes(rule.interval)}${align}`
}