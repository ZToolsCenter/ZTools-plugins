// 字段约束校验：必填（required）/ 唯一（unique）。纯函数，node 可直跑（不依赖 Vue）
import type { FieldDef, FieldValue, Row } from '../types/table.ts'
import { canBeUnique } from '../types/table.ts'
import { coerceFieldValue, displayValue, isEmptyValue } from './fieldTypes.ts'

export interface FieldIssue {
  fieldId: string
  fieldName: string
  kind: 'required' | 'unique'
  message: string
  /** 唯一冲突时命中的已有行 id */
  conflictRowId?: string
}

function fieldNameOf(field: FieldDef): string {
  return field.name || '未命名字段'
}

function requiredIssue(field: FieldDef): FieldIssue {
  const name = fieldNameOf(field)
  return {
    fieldId: field.id,
    fieldName: name,
    kind: 'required',
    message: `「${name}」不能为空`
  }
}

function uniqueIssue(field: FieldDef, value: FieldValue, conflictRowId?: string): FieldIssue {
  const name = fieldNameOf(field)
  const shown = displayValue(field, value) || String(value ?? '')
  const message = conflictRowId
    ? `「${name}」的值「${shown}」已存在，不能重复`
    : `「${name}」的值「${shown}」与前面的记录重复`
  return {
    fieldId: field.id,
    fieldName: name,
    kind: 'unique',
    message,
    ...(conflictRowId ? { conflictRowId } : {})
  }
}

/**
 * 查重比较用的归一化 key：先按字段类型归一化（数字/日期/多选与存储一致），
 * 文本再 trim + 忽略大小写。空值返回 null——空值不参与唯一判定（允许多行留空）。
 */
export function uniqueKeyOf(field: FieldDef, raw: FieldValue | undefined): string | null {
  if (isEmptyValue(raw)) return null
  const value = coerceFieldValue(field, raw)
  if (isEmptyValue(value)) return null
  switch (field.type) {
    case 'number':
      return typeof value === 'number' ? `n:${value}` : null
    case 'date':
      return typeof value === 'string' ? `d:${value}` : null
    case 'list':
    case 'multi_select':
      // 唯一对这两种类型不开放；万一备份里带了约束，按集合（与顺序无关）比较
      return `m:${(Array.isArray(value) ? value.map(String) : []).slice().sort().join('\u0001')}`
    case 'checkbox':
      return value === true ? 'b:1' : value === false ? 'b:0' : null
    default:
      return `s:${String(value).trim().toLowerCase()}`
  }
}

/**
 * 校验一行（新增或编辑）是否满足字段约束。
 * allRows 传当前表全部行；editingRowId 用于编辑时排除自己。
 */
export function validateRowValues(
  fields: FieldDef[],
  values: Record<string, FieldValue>,
  allRows: Row[],
  editingRowId?: string | null
): FieldIssue[] {
  const issues: FieldIssue[] = []
  for (const field of fields) {
    const value = values[field.id]
    if (field.required && isEmptyValue(value)) {
      issues.push(requiredIssue(field))
      continue
    }
    if (!field.unique || !canBeUnique(field)) continue
    const key = uniqueKeyOf(field, value)
    if (key == null) continue
    const conflict = allRows.find(
      (row) => row.id !== editingRowId && uniqueKeyOf(field, row.values[field.id]) === key
    )
    if (conflict) issues.push(uniqueIssue(field, value, conflict.id))
  }
  return issues
}

/**
 * 批量修改前的校验：唯一字段不能被多条记录改成同一个非空值，
 * 必填字段不能被清空；单条记录改唯一值时还要和其余记录比。
 */
export function validateBatchSetValue(
  field: FieldDef,
  value: FieldValue,
  allRows: Row[],
  targetIds: ReadonlySet<string>
): FieldIssue | null {
  if (field.required && isEmptyValue(value)) return requiredIssue(field)
  if (!field.unique || !canBeUnique(field)) return null
  const key = uniqueKeyOf(field, value)
  if (key == null) return null
  if (targetIds.size > 1) {
    const name = fieldNameOf(field)
    return {
      fieldId: field.id,
      fieldName: name,
      kind: 'unique',
      message: `「${name}」是唯一字段，不能给 ${targetIds.size} 条记录批量改成同一个非空值`
    }
  }
  const conflict = allRows.find(
    (row) => !targetIds.has(row.id) && uniqueKeyOf(field, row.values[field.id]) === key
  )
  return conflict ? uniqueIssue(field, value, conflict.id) : null
}

/** 存量数据的约束违规统计（表设置保存时用） */
export interface ConstraintViolation {
  fieldId: string
  fieldName: string
  kind: 'required' | 'unique'
  /** 违规记录数：必填=空值行数，唯一=落在重复组里的行数 */
  count: number
  /** 示例，最多几条，如「「125189」出现 2 次」 */
  examples: string[]
}

export function inspectConstraints(
  fields: FieldDef[],
  rows: Row[],
  maxExamples = 3
): ConstraintViolation[] {
  const out: ConstraintViolation[] = []
  for (const field of fields) {
    if (field.required) {
      const emptyCount = rows.filter((row) => isEmptyValue(row.values[field.id])).length
      if (emptyCount) {
        out.push({
          fieldId: field.id,
          fieldName: fieldNameOf(field),
          kind: 'required',
          count: emptyCount,
          examples: []
        })
      }
    }
    if (!field.unique || !canBeUnique(field)) continue
    const groups = new Map<string, { shown: string; count: number }>()
    for (const row of rows) {
      const key = uniqueKeyOf(field, row.values[field.id])
      if (key == null) continue
      const group = groups.get(key)
      if (group) group.count += 1
      else groups.set(key, { shown: displayValue(field, row.values[field.id]), count: 1 })
    }
    let count = 0
    const examples: string[] = []
    for (const group of groups.values()) {
      if (group.count < 2) continue
      count += group.count
      if (examples.length < maxExamples) examples.push(`「${group.shown}」出现 ${group.count} 次`)
    }
    if (count) {
      out.push({
        fieldId: field.id,
        fieldName: fieldNameOf(field),
        kind: 'unique',
        count,
        examples
      })
    }
  }
  return out
}

/** 把一条违规统计格式化成提示文案 */
export function describeViolation(v: ConstraintViolation): string {
  const head =
    v.kind === 'required'
      ? `「${v.fieldName}」有 ${v.count} 条记录为空`
      : `「${v.fieldName}」有 ${v.count} 条记录的值重复`
  return v.examples.length ? `${head}（${v.examples.join('，')}）` : head
}

/** 导入校验结果 */
export interface IncomingCheck {
  /** 与入参等长：null=通过，否则为该行的问题 */
  rowIssues: Array<FieldIssue[] | null>
  /** 通过校验、可以导入的行下标 */
  okIndexes: number[]
  /** 必填缺失的行数 */
  requiredRows: number
  /** 与存量或本批次其他行重复的行数 */
  duplicateRows: number
}

/**
 * 批量导入校验：先对存量数据建「已用值」索引，再逐行增量比对，整体 O(n+m)。
 * 只有完全通过校验的行才占用唯一值，避免将被跳过的行把后面的合法行挤成重复。
 */
export function checkIncomingRows(
  fields: FieldDef[],
  incoming: Array<Record<string, FieldValue>>,
  existingRows: Row[]
): IncomingCheck {
  const requiredFields = fields.filter((field) => field.required)
  const uniqueFields = fields.filter((field) => field.unique && canBeUnique(field))
  const seen = new Map<string, Set<string>>()
  for (const field of uniqueFields) {
    const keys = new Set<string>()
    for (const row of existingRows) {
      const key = uniqueKeyOf(field, row.values[field.id])
      if (key != null) keys.add(key)
    }
    seen.set(field.id, keys)
  }
  const rowIssues: Array<FieldIssue[] | null> = []
  const okIndexes: number[] = []
  let requiredRows = 0
  let duplicateRows = 0
  incoming.forEach((values, index) => {
    const issues: FieldIssue[] = []
    for (const field of requiredFields) {
      if (isEmptyValue(values[field.id])) issues.push(requiredIssue(field))
    }
    const freshKeys: Array<[FieldDef, string]> = []
    for (const field of uniqueFields) {
      const key = uniqueKeyOf(field, values[field.id])
      if (key == null) continue
      if (seen.get(field.id)!.has(key)) issues.push(uniqueIssue(field, values[field.id]))
      else freshKeys.push([field, key])
    }
    if (issues.length) {
      if (issues.some((issue) => issue.kind === 'required')) requiredRows += 1
      if (issues.some((issue) => issue.kind === 'unique')) duplicateRows += 1
      rowIssues.push(issues)
      return
    }
    for (const [field, key] of freshKeys) seen.get(field.id)!.add(key)
    rowIssues.push(null)
    okIndexes.push(index)
  })
  return { rowIssues, okIndexes, requiredRows, duplicateRows }
}