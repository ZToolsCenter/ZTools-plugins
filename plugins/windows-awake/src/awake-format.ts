/** 界面使用的常量与格式化工具。 */

/** 唤醒时长预设，value 为分钟数，0 表示一直保持。 */
export const PRESETS = [
  { label: '15 分钟', value: 15 },
  { label: '30 分钟', value: 30 },
  { label: '1 小时', value: 60 },
  { label: '2 小时', value: 120 },
  { label: '一直保持', value: 0 }
] as const

/** 桥接不可用（开发预览）时的兜底边界值，取值与 preload 保持一致。 */
const FALLBACK_LIMITS = { min: 1, max: 1440 }

/** 自定义时长的最小值（分钟）。 */
export const MIN_DURATION_MINUTES = window.awakeBridge?.constants?.MIN_DURATION_MINUTES ?? FALLBACK_LIMITS.min

/** 自定义时长的最大值（分钟）。 */
export const MAX_DURATION_MINUTES = window.awakeBridge?.constants?.MAX_DURATION_MINUTES ?? FALLBACK_LIMITS.max

/**
 * 补零。
 * @param value 数字。
 * @returns 至少两位的字符串。
 */
function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * 把秒数格式化为倒计时文本。
 * @param totalSeconds 总秒数。
 * @returns mm:ss 或 h:mm:ss。
 */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds % 60)}`
  return `${pad(minutes)}:${pad(seconds % 60)}`
}

/**
 * 把秒数格式化为人类可读时长。
 * @param totalSeconds 总秒数。
 * @param withSeconds 不足 1 分钟时是否显示秒数。
 * @returns 例如 “1 小时 20 分钟”。
 */
export function formatDuration(totalSeconds: number, withSeconds = false): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  if (hours > 0) return restMinutes > 0 ? `${hours} 小时 ${restMinutes} 分钟` : `${hours} 小时`
  if (minutes > 0) return `${minutes} 分钟`
  return withSeconds ? `${seconds} 秒` : '不足 1 分钟'
}

/**
 * 把时间戳格式化为本地时间。
 * @param timestamp 时间戳（毫秒）。
 * @returns HH:mm:ss。
 */
export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}
