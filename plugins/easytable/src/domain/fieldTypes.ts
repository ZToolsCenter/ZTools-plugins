import type { FieldDef, FieldValue, FieldType } from '../types/table.ts'
import { DEFAULT_MULTI_SEP, splitMultiValue } from './separators.ts'

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: '文本',
  longtext: '长文本',
  list: '列表',
  select: '单选',
  multi_select: '多选/标签',
  url: '链接',
  number: '数字',
  date: '日期',
  checkbox: '是否'
}

export const FIELD_TYPE_OPTIONS = (
  Object.keys(FIELD_TYPE_LABELS) as FieldType[]
).map((type) => ({ type, label: FIELD_TYPE_LABELS[type] }))

export function defaultValue(type: FieldType): FieldValue {
  switch (type) {
    case 'list':
    case 'multi_select':
      return []
    case 'number':
    case 'date':
      return null
    case 'checkbox':
      return false
    default:
      return ''
  }
}

/** 新建行时取字段默认值：配置了 default 用之，否则按类型给空值 */
export function initialFieldDefault(field: FieldDef): FieldValue {
  if (field.default !== undefined) return field.default
  return defaultValue(field.type)
}

/**
 * 新增字段回填已有数据：field.default 存在且非空时，把该值写进「缺失该字段」的行。
 * 返回新行数组；无变化返回 null。
 */
export function backfillField(
  rows: Array<{ id: string; values: Record<string, FieldValue> }>,
  field: FieldDef
): Array<{ id: string; values: Record<string, FieldValue> }> | null {
  const v = field.default
  // 空串 / null / undefined / 空数组都视为「未设置默认值」，不回填
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return null
  let changed = false
  const next = rows.map((r) => {
    if (r.values[field.id] !== undefined) return r
    changed = true
    return { ...r, values: { ...r.values, [field.id]: v } }
  })
  return changed ? next : null
}

export function createField(name: string, type: FieldType): FieldDef {
  const id = `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  if (type === 'select' || type === 'multi_select') {
    return { id, name, type, options: [] }
  }
  return { id, name, type } as FieldDef
}

/** 切换字段类型时尽量保留可迁移的数据；无法迁移则给默认值。 */
export function coerceFieldValue(field: FieldDef, raw: unknown): FieldValue {
  switch (field.type) {
    case 'text':
    case 'longtext':
    case 'url': {
      if (raw == null) return ''
      if (Array.isArray(raw)) return raw.map(String).join(DEFAULT_MULTI_SEP)
      if (typeof raw === 'boolean') return raw ? '是' : ''
      if (typeof raw === 'number') return String(raw)
      return String(raw)
    }
    case 'list':
    case 'multi_select': {
      if (Array.isArray(raw)) return raw.map(String).filter(Boolean)
      if (raw == null) return []
      return splitMultiValue(String(raw))
    }
    case 'select': {
      if (raw == null) return ''
      if (Array.isArray(raw)) return raw.length ? String(raw[0]) : ''
      return String(raw)
    }
    case 'number': {
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw
      if (raw == null || raw === '') return null
      const n = Number(String(raw).replace(/,/g, '').trim())
      return Number.isFinite(n) ? n : null
    }
    case 'date': {
      if (raw == null || raw === '') return null
      const s = String(raw).trim().replace(/\//g, '-')
      const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
      if (!m) return null
      const mm = m[2].padStart(2, '0')
      const dd = m[3].padStart(2, '0')
      return `${m[1]}-${mm}-${dd}`
    }
    case 'checkbox': {
      if (typeof raw === 'boolean') return raw
      if (typeof raw === 'number') return raw !== 0
      const s = String(raw ?? '').trim().toLowerCase()
      return s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === '是' || s === '✓'
    }
  }
}

export function displayValue(field: FieldDef, value: FieldValue, multiSep = '、'): string {
  if (value == null) return ''
  switch (field.type) {
    case 'list':
    case 'multi_select':
      return Array.isArray(value) ? value.join(multiSep) : String(value)
    case 'checkbox':
      return value ? '是' : ''
    case 'number':
      return value === '' || value === null ? '' : String(value)
    default:
      return String(value)
  }
}

export function searchTextOf(
  fields: FieldDef[],
  values: Record<string, FieldValue>,
  multiSep = '、'
): string {
  return fields
    .map((f) => displayValue(f, values[f.id] ?? defaultValue(f.type), multiSep))
    .join(' ')
    .toLowerCase()
}
