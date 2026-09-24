import { formatDate, startOfDay, WEEK_FULL_CN } from './date'

/**
 * 法定节假日与调休补班数据（内置，来源为国务院办公厅历年放假安排通知）：
 * 2024：国办发明电〔2023〕7号
 * 2025：国办发明电〔2024〕12号
 * 2026：国办发明电〔2025〕7号
 */
const rangeDates = (start: string, end: string): string[] => {
  const out: string[] = []
  const d = new Date(start)
  const stop = new Date(end).getTime()
  while (d.getTime() <= stop) {
    out.push(formatDate(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

const defineHolidays = (items: [string, string, string][]): Record<string, string> => {
  const map: Record<string, string> = {}
  for (const [start, end, name] of items) {
    for (const date of rangeDates(start, end)) map[date] = name
  }
  return map
}

/** 放假日 → 节日名 */
export const HOLIDAYS: Record<string, string> = defineHolidays([
  // 2024
  ['2024-01-01', '2024-01-01', '元旦'],
  ['2024-02-10', '2024-02-17', '春节'],
  ['2024-04-04', '2024-04-06', '清明节'],
  ['2024-05-01', '2024-05-05', '劳动节'],
  ['2024-06-08', '2024-06-10', '端午节'],
  ['2024-09-15', '2024-09-17', '中秋节'],
  ['2024-10-01', '2024-10-07', '国庆节'],
  // 2025
  ['2025-01-01', '2025-01-01', '元旦'],
  ['2025-01-28', '2025-02-04', '春节'],
  ['2025-04-04', '2025-04-06', '清明节'],
  ['2025-05-01', '2025-05-05', '劳动节'],
  ['2025-05-31', '2025-06-02', '端午节'],
  ['2025-10-01', '2025-10-08', '国庆节、中秋节'],
  // 2026
  ['2026-01-01', '2026-01-03', '元旦'],
  ['2026-02-15', '2026-02-23', '春节'],
  ['2026-04-04', '2026-04-06', '清明节'],
  ['2026-05-01', '2026-05-05', '劳动节'],
  ['2026-06-19', '2026-06-21', '端午节'],
  ['2026-09-25', '2026-09-27', '中秋节'],
  ['2026-10-01', '2026-10-07', '国庆节']
])

/** 调休补班日（周末上班）→ 说明 */
export const MAKEUP: Record<string, string> = {
  // 2024
  '2024-02-04': '春节补班',
  '2024-02-18': '春节补班',
  '2024-04-07': '清明节补班',
  '2024-04-28': '劳动节补班',
  '2024-05-11': '劳动节补班',
  '2024-09-14': '中秋节补班',
  '2024-09-29': '国庆节补班',
  '2024-10-12': '国庆节补班',
  // 2025
  '2025-01-26': '春节补班',
  '2025-02-08': '春节补班',
  '2025-04-27': '劳动节补班',
  '2025-09-28': '国庆节、中秋节补班',
  '2025-10-11': '国庆节、中秋节补班',
  // 2026
  '2026-01-04': '元旦补班',
  '2026-02-14': '春节补班',
  '2026-02-28': '春节补班',
  '2026-05-09': '劳动节补班',
  '2026-09-20': '国庆节补班',
  '2026-10-10': '国庆节补班'
}

export const HOLIDAY_YEAR_MIN = 2024
export const HOLIDAY_YEAR_MAX = 2026

/** 是否为工作日：周一到周五且非节假日，或周末调休补班 */
export function isWorkday(d: Date): boolean {
  const key = formatDate(d)
  if (key in HOLIDAYS) return false
  if (key in MAKEUP) return true
  const day = d.getDay()
  return day !== 0 && day !== 6
}

export interface DayItem {
  date: string
  week_name: string
  explain: string
}

const toItem = (d: Date, explain: string): DayItem => ({
  date: formatDate(d),
  week_name: WEEK_FULL_CN[d.getDay()],
  explain
})

/** [a, b] 闭区间内的节假日与调休补班明细 */
export function specialDaysInRange(a: Date, b: Date): { holidays: DayItem[]; makeup: DayItem[] } {
  const holidays: DayItem[] = []
  const makeup: DayItem[] = []
  const d = startOfDay(a)
  const stop = startOfDay(b).getTime()
  while (d.getTime() <= stop) {
    const key = formatDate(d)
    if (key in HOLIDAYS) holidays.push(toItem(d, HOLIDAYS[key] + '放假'))
    else if (key in MAKEUP) makeup.push(toItem(d, MAKEUP[key]))
    d.setDate(d.getDate() + 1)
  }
  return { holidays, makeup }
}

/** 从 d 起推算 n 个工作日（跳过周末与节假日，计入调休补班；n 可为负） */
export function addWorkdaysCn(d: Date, n: number): Date {
  const r = startOfDay(d)
  const step = n >= 0 ? 1 : -1
  let remain = Math.abs(n)
  while (remain > 0) {
    r.setDate(r.getDate() + step)
    if (isWorkday(r)) remain--
  }
  return r
}

/** [a, b] 闭区间统计：总天数与工作日天数（含节假日和调休规则） */
export function workdayStatsCn(a: Date, b: Date): { total: number; workdays: number } {
  const d = startOfDay(a)
  const stop = startOfDay(b).getTime()
  let total = 0
  let workdays = 0
  while (d.getTime() <= stop) {
    total++
    if (isWorkday(d)) workdays++
    d.setDate(d.getDate() + 1)
  }
  return { total, workdays }
}
