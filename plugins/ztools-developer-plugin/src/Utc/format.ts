// 时间格式化与时区列表工具

export interface FormatOptions {
  /** 显示年月日 */
  showDate: boolean
  /** 显示星期 */
  showWeekday: boolean
  /** 显示时分秒 */
  showTime: boolean
  /** 显示毫秒 */
  showMs: boolean
  /** 12 小时制 */
  hour12: boolean
}

export const DEFAULT_FORMAT: FormatOptions = {
  showDate: true,
  showWeekday: false,
  showTime: true,
  showMs: true,
  hour12: false
}

// Intl.supportedValuesOf 不可用时的兜底时区列表
const FALLBACK_TIMEZONES: string[] = [
  'UTC',
  'Africa/Cairo',
  'America/Argentina/Buenos_Aires',
  'America/Chicago',
  'America/Los_Angeles',
  'America/New_York',
  'America/Sao_Paulo',
  'Asia/Bangkok',
  'Asia/Dubai',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Europe/Berlin',
  'Europe/London',
  'Europe/Moscow',
  'Europe/Paris',
  'Pacific/Auckland'
]

/** 获取完整时区列表（Intl.supportedValuesOf 不可用时回退到内置列表） */
export function getTimezones(): string[] {
  try {
    const supported = (Intl as any).supportedValuesOf
      ? (Intl as any).supportedValuesOf('timeZone')
      : null
    if (Array.isArray(supported) && supported.length > 0) {
      // 确保 UTC 排首位
      const list = supported.filter((tz: string) => tz !== 'UTC')
      return ['UTC', ...list]
    }
  } catch (_e) {
    // ignore
  }
  return FALLBACK_TIMEZONES.slice()
}

// 常用时区的中文名称（仅用于显示；未收录的时区回退显示 IANA 名称）
const TZ_DISPLAY_NAMES: Record<string, string> = {
  'UTC': '协调世界时',
  'Africa/Cairo': '埃及标准时间',
  'Africa/Johannesburg': '南非标准时间',
  'Africa/Lagos': '西非时间',
  'Africa/Nairobi': '东非时间',
  'America/Anchorage': '阿拉斯加时间',
  'America/Argentina/Buenos_Aires': '阿根廷时间',
  'America/Chicago': '美国中部时间',
  'America/Denver': '美国山地时间',
  'America/Los_Angeles': '美国太平洋时间',
  'America/Mexico_City': '墨西哥时间',
  'America/New_York': '美国东部时间',
  'America/Phoenix': '亚利桑那时间',
  'America/Sao_Paulo': '巴西时间',
  'America/Toronto': '加拿大多伦多时间',
  'America/Vancouver': '加拿大温哥华时间',
  'Asia/Bangkok': '泰国时间',
  'Asia/Dhaka': '孟加拉时间',
  'Asia/Dubai': '海湾标准时间',
  'Asia/Hong_Kong': '香港时间',
  'Asia/Jakarta': '印尼西部时间',
  'Asia/Karachi': '巴基斯坦时间',
  'Asia/Kolkata': '印度标准时间',
  'Asia/Kuala_Lumpur': '马来西亚时间',
  'Asia/Manila': '菲律宾时间',
  'Asia/Riyadh': '阿拉伯标准时间',
  'Asia/Seoul': '韩国标准时间',
  'Asia/Shanghai': '中国标准时间',
  'Asia/Singapore': '新加坡时间',
  'Asia/Taipei': '台北时间',
  'Asia/Tehran': '伊朗时间',
  'Asia/Tokyo': '日本标准时间',
  'Asia/Urumqi': '乌鲁木齐时间',
  'Asia/Vladivostok': '海参崴时间',
  'Asia/Yekaterinburg': '叶卡捷琳堡时间',
  'Australia/Adelaide': '澳大利亚中部时间',
  'Australia/Brisbane': '澳大利亚东部时间',
  'Australia/Melbourne': '澳大利亚东部时间',
  'Australia/Perth': '澳大利亚西部时间',
  'Australia/Sydney': '澳大利亚东部时间',
  'Europe/Amsterdam': '阿姆斯特丹时间',
  'Europe/Athens': '东欧时间',
  'Europe/Berlin': '中欧时间',
  'Europe/Brussels': '布鲁塞尔时间',
  'Europe/Helsinki': '东欧时间',
  'Europe/Istanbul': '土耳其时间',
  'Europe/Kiev': '东欧时间',
  'Europe/Lisbon': '西欧时间',
  'Europe/London': '格林尼治时间',
  'Europe/Madrid': '中欧时间',
  'Europe/Moscow': '莫斯科时间',
  'Europe/Oslo': '中欧时间',
  'Europe/Paris': '中欧时间',
  'Europe/Prague': '中欧时间',
  'Europe/Rome': '中欧时间',
  'Europe/Stockholm': '中欧时间',
  'Europe/Vienna': '中欧时间',
  'Europe/Warsaw': '中欧时间',
  'Europe/Zurich': '中欧时间',
  'Pacific/Auckland': '新西兰时间',
  'Pacific/Fiji': '斐济时间',
  'Pacific/Honolulu': '夏威夷时间',
  // Intl.supportedValuesOf 在部分 ICU 版本返回的旧别名，补充对应中文显示名
  'Asia/Calcutta': '印度标准时间',
  'Asia/Kathmandu': '尼泊尔时间',
  'Asia/Katmandu': '尼泊尔时间',
  'Asia/Yangon': '缅甸时间',
  'Asia/Rangoon': '缅甸时间',
  'Asia/Kabul': '阿富汗时间',
  'Asia/Magadan': '马加丹时间',
  'America/Nuuk': '格陵兰时间',
  'America/Godthab': '格陵兰时间',
  'America/St_Johns': '纽芬兰时间',
  'America/Miquelon': '圣皮埃尔和密克隆时间',
  'America/Adak': '阿留申群岛时间',
  'Pacific/Midway': '中途岛时间',
  'Pacific/Marquesas': '马克萨斯群岛时间',
  'Pacific/Chatham': '查塔姆群岛时间',
  'Pacific/Apia': '萨摩亚时间',
  'Pacific/Kiritimati': '莱恩群岛时间',
  'Australia/Eucla': '尤克拉时间',
  'Australia/Lord_Howe': '豪勋爵群岛时间'
}

/** 计算时区在指定时刻相对 UTC 的偏移分钟数（含夏令时），失败返回 null */
export function getTimezoneOffsetMinutes(tz: string, date = new Date()): number | null {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    })
    const parts = dtf.formatToParts(date)
    const get = (type: string) => Number(parts.find(p => p.type === type)?.value)
    const asUTC = Date.UTC(
      get('year'), get('month') - 1, get('day'),
      get('hour') % 24, get('minute'), get('second')
    )
    return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000)
  } catch (_e) {
    return null
  }
}

/** 偏移分钟 → "UTC+8" / "UTC-5:30" / "UTC+5:30" 样式 */
export function formatOffsetLabel(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return `UTC${sign}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`
}

// 同偏移去重时的代表时区（排名靠前优先；如 UTC+8 保留 Asia/Shanghai 而非台北/新加坡等）
const REPRESENTATIVE_TIMEZONES = [
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Tehran',
  'Asia/Kathmandu',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Moscow',
  'Europe/Istanbul',
  'Africa/Cairo',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Africa/Nairobi',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Adelaide',
  'Pacific/Honolulu',
  'Pacific/Auckland'
]

/** 时区在代表列表中的排名（不在列表返回 Infinity，越小越优先） */
function representativeRank(tz: string): number {
  const idx = REPRESENTATIVE_TIMEZONES.indexOf(tz)
  return idx === -1 ? Number.POSITIVE_INFINITY : idx
}

/** 同偏移去重时判断 candidate 是否优先于 current：代表排名靠前 > 有中文显示名 */
function isPreferred(candidate: string, current: string): boolean {
  const cr = representativeRank(candidate)
  const cur = representativeRank(current)
  if (cr !== cur) return cr < cur
  // 均不在代表列表时，有中文显示名的优先；都无则保持先来者
  return !TZ_DISPLAY_NAMES[current] && !!TZ_DISPLAY_NAMES[candidate]
}

export interface TimezoneOption {
  /** IANA 时区名（存储值） */
  value: string
  /** 显示名：如 "UTC+8 中国标准时间" */
  label: string
  /** 排序权重（偏移分钟） */
  offset: number
}

/**
 * 生成 "UTC±X 中文名" 的时区选项列表
 * 每个 UTC 偏移仅保留一个代表时区（如 UTC+8 只保留中国标准时间），按偏移排序
 */
export function getTimezoneOptions(date = new Date()): TimezoneOption[] {
  const tzs = getTimezones()
  // 按偏移去重：offset -> 该偏移的代表选项
  const byOffset = new Map<number, TimezoneOption>()
  for (const tz of tzs) {
    if (tz === 'UTC') continue
    const off = getTimezoneOffsetMinutes(tz, date)
    // 偏移 0 固定由下方 UTC 选项代表
    if (off === null || off === 0) continue
    const existing = byOffset.get(off)
    if (existing && !isPreferred(tz, existing.value)) continue
    byOffset.set(off, {
      value: tz,
      label: `${formatOffsetLabel(off)} ${TZ_DISPLAY_NAMES[tz] || tz}`,
      offset: off
    })
  }
  // UTC 固定第一，其余按偏移升序
  return [
    { value: 'UTC', label: 'UTC+0 协调世界时', offset: 0 },
    ...[...byOffset.values()].sort((a, b) => a.offset - b.offset)
  ]
}

/** 取某时区的显示名（当前偏移 + 中文名），用于界面展示当前选择 */
export function getTimezoneLabel(tz: string, date = new Date()): string {
  if (tz === 'UTC') return 'UTC+0 协调世界时'
  const off = getTimezoneOffsetMinutes(tz, date)
  if (off === null) return tz
  return `${formatOffsetLabel(off)} ${TZ_DISPLAY_NAMES[tz] || tz}`
}

/**
 * 按勾选组件格式化时间字符串
 * 使用 Intl.DateTimeFormat 支持任意 IANA 时区
 */
export function formatTime(date: Date, opts: FormatOptions, timeZone: string): string {
  const parts: string[] = []

  // 日期部分
  if (opts.showDate || opts.showWeekday) {
    const dateOpts: Intl.DateTimeFormatOptions = { timeZone }
    if (opts.showWeekday) dateOpts.weekday = 'long'
    if (opts.showDate) {
      dateOpts.year = 'numeric'
      dateOpts.month = '2-digit'
      dateOpts.day = '2-digit'
    }
    try {
      const formatted = new Intl.DateTimeFormat('zh-CN', dateOpts).format(date)
      if (formatted) parts.push(formatted)
    } catch (_e) {
      // 时区非法时退回本地时区
      const fallback = new Intl.DateTimeFormat('zh-CN', { ...dateOpts, timeZone: undefined }).format(date)
      if (fallback) parts.push(fallback)
    }
  }

  // 时间部分
  if (opts.showTime) {
    const timeOpts: Intl.DateTimeFormatOptions = {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: opts.hour12
    }
    try {
      const formatted = new Intl.DateTimeFormat('zh-CN', timeOpts).format(date)
      if (formatted) parts.push(formatted)
    } catch (_e) {
      const fallback = new Intl.DateTimeFormat('zh-CN', { ...timeOpts, timeZone: undefined }).format(date)
      if (fallback) parts.push(fallback)
    }
  }

  // 毫秒部分（Intl fractionalSecondDigits 仅支持 3 位，这里直接补零拼接）
  if (opts.showMs) {
    const ms = String(date.getMilliseconds()).padStart(3, '0')
    parts.push('.' + ms)
  }

  return parts.filter(Boolean).join(' ').trim()
}
