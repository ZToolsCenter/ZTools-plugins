import type { TimestampUnit, TimezoneOption } from '@/types'

export function dateToTzParts(date: Date, tz: TimezoneOption) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz.iana,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
  const parts = formatter.formatToParts(date)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '0'
  return {
    year: parseInt(get('year')),
    month: parseInt(get('month')),
    day: parseInt(get('day')),
    hour: parseInt(get('hour')) % 24,
    minute: parseInt(get('minute')),
    second: parseInt(get('second'))
  }
}

export function tzPartsToTimestamp(
  year: number, month: number, day: number,
  hour: number, minute: number, second: number,
  tz: TimezoneOption
): number {
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second)
  return utcMs - tz.offset * 3600_000
}

export function formatTimestamp(ms: number, tz: TimezoneOption): string {
  const date = new Date(ms)
  const p = dateToTzParts(date, tz)
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
}

export function formatTimestampMulti(ms: number, tz: TimezoneOption): string[] {
  const date = new Date(ms)
  const p = dateToTzParts(date, tz)
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']

  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz.iana,
    weekday: 'short'
  }).format(date)

  const dayOfWeek = weekdays[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()] ?? formatted

  return [
    `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`,
    `${p.year}年${p.month}月${p.day}日 星期${dayOfWeek} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`,
    `${pad(p.month)}/${pad(p.day)}/${p.year} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
  ]
}

/**
 * 毫秒时间戳 → 指定单位的时间戳字符串
 * @param ms 毫秒时间戳（可含小数以提供亚毫秒精度）
 */
export function msToUnit(ms: number, unit: TimestampUnit): string {
  switch (unit) {
    case 'second': return Math.floor(ms / 1000).toString()
    case 'millisecond': return Math.floor(ms).toString()
    case 'nanosecond': {
      const intMs = Math.floor(ms)
      const fracMs = ms - intMs
      const nsStr = BigInt(intMs) * 1000000n + BigInt(Math.round(fracMs * 1000000))
      return nsStr.toString()
    }
  }
}

export function unitToMs(value: string, unit: TimestampUnit): number | null {
  const trimmed = value.trim()
  if (!trimmed || !/^-?\d+$/.test(trimmed)) return null
  switch (unit) {
    case 'second': return parseInt(trimmed) * 1000
    case 'millisecond': return parseInt(trimmed)
    case 'nanosecond': {
      const ns = BigInt(trimmed)
      const ms = Number(ns / 1000000n)
      const remNs = Number(ns % 1000000n)
      return ms + remNs / 1000000
    }
  }
}

export function detectUnit(value: string): TimestampUnit | null {
  const trimmed = value.trim().replace(/^-/, '')
  if (!/^\d+$/.test(trimmed)) return null
  const len = trimmed.length
  if (len === 10) return 'second'
  if (len === 13) return 'millisecond'
  if (len >= 18 && len <= 20) return 'nanosecond'
  return null
}

export function formatRelativeTime(targetMs: number, nowMs: number): string {
  const diff = targetMs - nowMs
  const absDiff = Math.abs(diff)
  const suffix = diff >= 0 ? '后' : '前'

  const MINUTE = 60_000
  const HOUR = 3_600_000
  const DAY = 86_400_000
  const MONTH = 30 * DAY
  const YEAR = 365 * DAY

  if (absDiff < MINUTE) return diff >= 0 ? '即刻' : '刚刚'
  if (absDiff < HOUR) return `${Math.floor(absDiff / MINUTE)} 分钟${suffix}`
  if (absDiff < DAY) return `${Math.floor(absDiff / HOUR)} 小时${suffix}`
  if (absDiff < MONTH) return `${Math.floor(absDiff / DAY)} 天${suffix}`
  if (absDiff < YEAR) return `${Math.floor(absDiff / MONTH)} 个月${suffix}`
  return `${(absDiff / YEAR).toFixed(1)} 年${suffix}`
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}
