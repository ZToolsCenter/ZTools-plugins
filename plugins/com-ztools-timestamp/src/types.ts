export type TimestampUnit = 'second' | 'millisecond' | 'nanosecond'

export interface TimezoneOption {
  label: string
  offset: number
  iana: string
}

export const UNIT_LABELS: Record<TimestampUnit, string> = {
  nanosecond: '纳秒',
  millisecond: '毫秒',
  second: '秒'
}

export const TIMEZONE_OPTIONS: TimezoneOption[] = [
  { label: 'UTC-12:00 | 贝克岛', offset: -12, iana: 'Etc/GMT+12' },
  { label: 'UTC-11:00 | 帕果帕果', offset: -11, iana: 'Pacific/Pago_Pago' },
  { label: 'UTC-10:00 | 檀香山', offset: -10, iana: 'Pacific/Honolulu' },
  { label: 'UTC-09:00 | 安克雷奇', offset: -9, iana: 'America/Anchorage' },
  { label: 'UTC-08:00 | 洛杉矶', offset: -8, iana: 'America/Los_Angeles' },
  { label: 'UTC-07:00 | 丹佛', offset: -7, iana: 'America/Denver' },
  { label: 'UTC-06:00 | 芝加哥', offset: -6, iana: 'America/Chicago' },
  { label: 'UTC-05:00 | 纽约', offset: -5, iana: 'America/New_York' },
  { label: 'UTC-04:00 | 圣地亚哥', offset: -4, iana: 'America/Santiago' },
  { label: 'UTC-03:00 | 圣保罗', offset: -3, iana: 'America/Sao_Paulo' },
  { label: 'UTC-02:00 | 中大西洋', offset: -2, iana: 'Atlantic/South_Georgia' },
  { label: 'UTC-01:00 | 亚速尔群岛', offset: -1, iana: 'Atlantic/Azores' },
  { label: 'UTC+00:00 | 伦敦', offset: 0, iana: 'Europe/London' },
  { label: 'UTC+01:00 | 巴黎', offset: 1, iana: 'Europe/Paris' },
  { label: 'UTC+02:00 | 开罗', offset: 2, iana: 'Africa/Cairo' },
  { label: 'UTC+03:00 | 莫斯科', offset: 3, iana: 'Europe/Moscow' },
  { label: 'UTC+04:00 | 迪拜', offset: 4, iana: 'Asia/Dubai' },
  { label: 'UTC+05:00 | 卡拉奇', offset: 5, iana: 'Asia/Karachi' },
  { label: 'UTC+05:30 | 孟买', offset: 5.5, iana: 'Asia/Kolkata' },
  { label: 'UTC+06:00 | 达卡', offset: 6, iana: 'Asia/Dhaka' },
  { label: 'UTC+07:00 | 曼谷', offset: 7, iana: 'Asia/Bangkok' },
  { label: 'UTC+08:00 | 北京', offset: 8, iana: 'Asia/Shanghai' },
  { label: 'UTC+09:00 | 东京', offset: 9, iana: 'Asia/Tokyo' },
  { label: 'UTC+09:30 | 阿德莱德', offset: 9.5, iana: 'Australia/Adelaide' },
  { label: 'UTC+10:00 | 悉尼', offset: 10, iana: 'Australia/Sydney' },
  { label: 'UTC+11:00 | 所罗门群岛', offset: 11, iana: 'Pacific/Guadalcanal' },
  { label: 'UTC+12:00 | 奥克兰', offset: 12, iana: 'Pacific/Auckland' },
  { label: 'UTC+13:00 | 汤加', offset: 13, iana: 'Pacific/Tongatapu' }
]

export function getLocalTimezoneIndex(): number {
  const offsetMinutes = new Date().getTimezoneOffset()
  const offsetHours = -offsetMinutes / 60
  const idx = TIMEZONE_OPTIONS.findIndex(tz => tz.offset === offsetHours)
  return idx >= 0 ? idx : TIMEZONE_OPTIONS.findIndex(tz => tz.offset === 8)
}
