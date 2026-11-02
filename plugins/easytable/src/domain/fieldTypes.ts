import type { FieldDef, FieldValue, FieldType, Row } from '../types/table.ts'
import { hasOptions } from '../types/table.ts'
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

/**
 * 空值判定：null / '' / 空数组 / 只含空白算空。
 * 0 和 false 是有效值，不算空（否则数字 0、是否「否」会被误判）。
 * 必填校验与筛选的「为空 / 不为空」共用同一判定，保证两处语义一致。
 */
export function isEmptyValue(value: unknown): boolean {
  if (value == null) return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'string') return value.trim() === ''
  return false
}

/** 新建行时取字段默认值：配置了 default 用之，否则按类型给空值 */
export function initialFieldDefault(field: FieldDef): FieldValue {
  if (field.default !== undefined) return field.default
  return defaultValue(field.type)
}

/**
 * 新增字段回填已有数据：field.default 存在且非空时，把该值写进「缺失该字段」的行。
 * 返回新行数组与被改写的行数；无变化返回 null。
 */
export function backfillField<T extends { values: Record<string, FieldValue> }>(
  rows: T[],
  field: FieldDef
): { rows: T[]; changedRows: number } | null {
  const v = field.default
  // 空串 / null / undefined / 空数组都视为「未设置默认值」，不回填
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return null
  let changedRows = 0
  const next = rows.map((r) => {
    if (r.values[field.id] !== undefined) return r
    changedRows += 1
    return { ...r, values: { ...r.values, [field.id]: v } }
  })
  return changedRows ? { rows: next, changedRows } : null
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

/**
 * 一个值在某字段下会拆成哪些候选选项：单选取整串，多选/列表按「、 ， , |」拆分。
 * 与 coerceFieldValue 同一套语义，保证「选项」和「转换后真正存下的值」能对上。
 */
function optionCandidates(field: FieldDef, value: FieldValue | undefined): string[] {
  if (value == null || value === '') return []
  const coerced = coerceFieldValue(field, value)
  const list = Array.isArray(coerced) ? coerced : coerced === '' ? [] : [String(coerced)]
  return list.map((s) => String(s).trim()).filter(Boolean)
}

/**
 * 把某个值收进单选/多选的选项列表（会就地修改 field.options）。
 * 返回是否新增了选项。
 */
export function addFieldOptions(field: FieldDef, value: FieldValue): boolean {
  if (!hasOptions(field)) return false
  let changed = false
  for (const s of optionCandidates(field, value)) {
    if (field.options.includes(s)) continue
    field.options.push(s)
    changed = true
  }
  return changed
}

/**
 * 收集某字段在已有行里的全部不同取值（按出现顺序去重，跳过空值）。
 * 「文本 → 单选/多选」时用它生成选项，转换后已有数据不会变成下拉里选不到的值。
 */
export function collectFieldOptions(
  rows: Array<{ values: Record<string, FieldValue> }>,
  field: FieldDef
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const s of optionCandidates(field, row.values[field.id])) {
      if (seen.has(s)) continue
      seen.add(s)
      out.push(s)
    }
  }
  return out
}

/** 值相等判定：数组逐项比较，其余用 === */
function sameFieldValue(a: FieldValue | undefined, b: FieldValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => v === b[i])
  }
  return a === b
}

/**
 * 字段改了类型后，按新类型转换已有行的值（只处理 fieldIds 指定的字段）。
 * 返回新行数组与被改写的行数；全部无变化返回 null。
 * 有意不动行上的 updatedAt：类型迁移属于结构调整，不该把「修改时间」列全部刷新。
 */
export function coerceRowsToFields<T extends { values: Record<string, FieldValue> }>(
  rows: T[],
  fields: FieldDef[],
  fieldIds: string[]
): { rows: T[]; changedRows: number } | null {
  const targets = fields.filter((f) => fieldIds.includes(f.id))
  if (!targets.length) return null
  let changedRows = 0
  const next = rows.map((row) => {
    let values: Record<string, FieldValue> | null = null
    for (const f of targets) {
      const raw = row.values[f.id]
      const coerced = coerceFieldValue(f, raw)
      if (sameFieldValue(raw, coerced)) continue
      values = values ?? { ...row.values }
      values[f.id] = coerced
    }
    if (!values) return row
    changedRows += 1
    return { ...row, values }
  })
  return changedRows ? { rows: next, changedRows } : null
}

/**
 * 批量修改：把指定行的某个字段统一改成同一个值。
 * targetIds 给定时只处理这些行，否则处理全部（未勾选视为全部）。
 * 只改真正变化的行，并刷新它们的 updatedAt——这是内容修改，不同于
 * coerceRowsToFields 的结构调整；全部无变化返回 null，避免「修改时间」被无谓刷新。
 */
export function batchSetFieldValue(
  rows: Row[],
  fieldId: string,
  value: FieldValue,
  targetIds?: ReadonlySet<string>
): { rows: Row[]; changedRows: number } | null {
  if (targetIds && !targetIds.size) return null
  const now = Date.now()
  let changedRows = 0
  const next = rows.map((row) => {
    if (targetIds && !targetIds.has(row.id)) return row
    if (sameFieldValue(row.values[fieldId], value)) return row
    changedRows += 1
    return { ...row, values: { ...row.values, [fieldId]: value }, updatedAt: now }
  })
  return changedRows ? { rows: next, changedRows } : null
}
