export const pad = (n: number, len = 2) => String(Math.abs(n)).padStart(len, '0')

export const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export const WEEK_FULL_CN = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

const DAY_MS = 24 * 60 * 60 * 1000

export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function formatDateTime(d: Date): string {
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 转为 datetime-local 控件的取值格式 YYYY-MM-DDTHH:mm:ss */
export function toDatetimeLocal(d: Date): string {
  return `${formatDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 解析 YYYY-MM-DD / YYYY-MM-DD HH:mm:ss / YYYY-MM-DDTHH:mm:ss，失败返回 null */
export function parseDateInput(s: string): Date | null {
  const m = s
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/)
  if (!m) return null
  const d = new Date(
    +m[1],
    +m[2] - 1,
    +m[3],
    +(m[4] || 0),
    +(m[5] || 0),
    +(m[6] || 0)
  )
  // 校验回读，排除 2026-02-31 这类溢出日期
  if (d.getFullYear() !== +m[1] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) {
    return null
  }
  return d
}

export function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate()
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

/** 加减月份，超出目标月天数时收敛到月末（1-31 加 1 月 → 2-28/29） */
export function addMonthsClamped(d: Date, n: number): Date {
  const totalMonth = d.getMonth() + n
  const year = d.getFullYear() + Math.floor(totalMonth / 12)
  const month0 = ((totalMonth % 12) + 12) % 12
  const day = Math.min(d.getDate(), daysInMonth(year, month0))
  return new Date(year, month0, day, d.getHours(), d.getMinutes(), d.getSeconds())
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** b - a 的整天数（按自然日零点计算） */
export function diffDays(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS)
}

/**
 * a <= b 时的年月日差。
 * 锚点法：先取不超过 b 的最大整月数，剩余部分按实际日历天数补齐，
 * 避免借位法在短月（如 1-31 → 3-01 跨 2 月）时出现负天数。
 */
export function diffYMD(a: Date, b: Date): { years: number; months: number; days: number } {
  const a0 = startOfDay(a)
  const b0 = startOfDay(b)
  let totalMonths =
    (b0.getFullYear() - a0.getFullYear()) * 12 + (b0.getMonth() - a0.getMonth())
  let anchor = addMonthsClamped(a0, totalMonths)
  if (anchor.getTime() > b0.getTime()) {
    totalMonths--
    anchor = addMonthsClamped(a0, totalMonths)
  }
  return {
    years: Math.floor(totalMonths / 12),
    months: totalMonths % 12,
    days: diffDays(anchor, b0)
  }
}

/** 从 d 起推算 n 个工作日（跳过周六周日，n 可为负） */
export function addWorkdays(d: Date, n: number): Date {
  const r = startOfDay(d)
  const step = n >= 0 ? 1 : -1
  let remain = Math.abs(n)
  while (remain > 0) {
    r.setDate(r.getDate() + step)
    const day = r.getDay()
    if (day !== 0 && day !== 6) remain--
  }
  return r
}

/** [a, b] 闭区间的总天数 / 工作日 / 周末天数（仅按周六周日划分） */
export function workdayStats(a: Date, b: Date): { total: number; workdays: number; weekends: number } {
  const total = diffDays(a, b) + 1
  if (total <= 0) return { total: 0, workdays: 0, weekends: 0 }
  const fullWeeks = Math.floor(total / 7)
  let workdays = fullWeeks * 5
  const startDay = startOfDay(a).getDay()
  for (let i = 0; i < total % 7; i++) {
    const day = (startDay + i) % 7
    if (day !== 0 && day !== 6) workdays++
  }
  return { total, workdays, weekends: total - workdays }
}

const dtfCache: Record<string, Intl.DateTimeFormat> = {}

function getTzFormatter(tz: string): Intl.DateTimeFormat {
  if (!dtfCache[tz]) {
    dtfCache[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }
  return dtfCache[tz]
}

/** 指定时刻在目标时区的 UTC 偏移毫秒数 */
export function tzOffsetMs(tz: string, at: Date): number {
  const parts = getTzFormatter(tz).formatToParts(at)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  const asUtc = Date.UTC(
    +map.year,
    +map.month - 1,
    +map.day,
    +map.hour % 24,
    +map.minute,
    +map.second
  )
  return asUtc - Math.floor(at.getTime() / 1000) * 1000
}

/**
 * 把"时区 tz 的墙上时间"转成真实时刻。
 * wallUtcMs 为把墙上时间各字段按 UTC 解释得到的毫秒数（Date.UTC(y, m, d, h, min)）。
 * 迭代两次以覆盖夏令时切换边界。
 */
export function wallTimeToUtc(wallUtcMs: number, tz: string): Date {
  let guess = wallUtcMs - tzOffsetMs(tz, new Date(wallUtcMs))
  guess = wallUtcMs - tzOffsetMs(tz, new Date(guess))
  return new Date(guess)
}

/** 某一时刻在目标时区的墙上时间字符串 */
export function formatInTz(instant: Date, tz: string, withSeconds = true): string {
  const u = new Date(instant.getTime() + tzOffsetMs(tz, instant))
  const date = `${u.getUTCFullYear()}-${pad(u.getUTCMonth() + 1)}-${pad(u.getUTCDate())}`
  const time = `${pad(u.getUTCHours())}:${pad(u.getUTCMinutes())}${
    withSeconds ? ':' + pad(u.getUTCSeconds()) : ''
  }`
  return `${date} ${time}`
}

/** 某一时刻在目标时区的星期（中文） */
export function weekdayInTz(instant: Date, tz: string): string {
  const u = new Date(instant.getTime() + tzOffsetMs(tz, instant))
  return WEEKDAY_CN[u.getUTCDay()]
}

/** 偏移毫秒 → "UTC+08:00" */
export function formatOffset(ms: number): string {
  const sign = ms >= 0 ? '+' : '-'
  const abs = Math.abs(ms)
  const h = Math.floor(abs / 3600000)
  const m = Math.floor((abs % 3600000) / 60000)
  return `UTC${sign}${pad(h)}:${pad(m)}`
}
