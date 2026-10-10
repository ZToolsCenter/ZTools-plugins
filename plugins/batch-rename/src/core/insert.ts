import type { FileItem, InsertRule } from './session'
import { formatSequence } from './number'

export function applyInsertRule(file: FileItem, index: number, rule: InsertRule): { name: string; error?: string } {
  const content = createContent(file, index, rule)
  if (content.error) return { name: file.currentName, error: content.error }

  const points = Array.from(file.baseName)
  let position = 0
  if (rule.position === 'end') {
    position = points.length
  } else if (rule.position === 'index') {
    if (!Number.isInteger(rule.index) || rule.index < 1) {
      return { name: file.currentName, error: '指定位置必须是正整数' }
    }
    position = Math.min(rule.index - 1, points.length)
  }

  points.splice(position, 0, content.value)
  return { name: `${points.join('')}${file.extension}` }
}

function createContent(file: FileItem, index: number, rule: InsertRule): { value: string; error?: string } {
  if (rule.kind === 'text') return { value: rule.text }
  if (rule.kind === 'number') {
    const sequence = formatSequence(rule.number.start + index, rule.number.style, rule.number.digits)
    return { value: `${rule.number.prefix}${sequence}${rule.number.suffix}` }
  }

  const info = readFileInfo(file, rule.info)
  if (info.error) return info
  return { value: `${rule.prefix}${info.value}${rule.suffix}` }
}

function readFileInfo(file: FileItem, info: InsertRule['info']): { value: string; error?: string } {
  if (info === 'created') return formatDate(file.createdAt, '无法读取文件创建时间')
  if (info === 'modified') return formatDate(file.modifiedAt, '无法读取文件修改时间')
  if (info === 'captured') return formatDate(file.metadata?.capturedAt, '无法读取照片拍摄时间')
  if (info === 'size') return formatSize(file.size)
  return formatDimensions(file.metadata?.dimensions)
}

function formatDate(value: number | undefined, error: string): { value: string; error?: string } {
  if (value === undefined || !Number.isFinite(value)) return { value: '', error }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { value: '', error }
  const pad = (part: number) => String(part).padStart(2, '0')
  return {
    value: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  }
}

function formatSize(value: number | undefined): { value: string; error?: string } {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return { value: '', error: '无法读取文件大小' }
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let amount = value
  let unit = 0
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024
    unit += 1
  }
  const formatted = unit === 0 ? String(Math.round(amount)) : amount.toFixed(1).replace(/\.0$/, '')
  return { value: `${formatted}${units[unit]}` }
}

function formatDimensions(value: string | undefined): { value: string; error?: string } {
  const match = value?.match(/^\s*(\d+)\s*(?:x|×)\s*(\d+)\s*$/i)
  if (!match) return { value: '', error: '无法读取图片尺寸' }
  return { value: `${match[1]}x${match[2]}` }
}
