import { FILE_SIZE_UNITS } from './constants'

/** 将字节数格式化为人类可读的文件大小字符串 */
export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + FILE_SIZE_UNITS[i]
}
