// 高级筛选：AND 条件组 + 时间范围 + 空值判定（纯函数，node 可直跑）
// 条件模型见 types/table.ts 的 FilterCond；本文件只做「派生操作符 + 行匹配 + 时间范围」

import type { FieldDef, FilterCond, FilterOp } from '../types/table.ts'
import { CREATED_AT_FIELD_ID, UPDATED_AT_FIELD_ID } from '../types/table.ts'
import { displayValue } from './fieldTypes.ts'

/** 系统列的虚拟字段定义（筛选/表单共用） */
export function systemField(id: string): FieldDef {
  if (id === UPDATED_AT_FIELD_ID) {
    return { id: UPDATED_AT_FIELD_ID, name: '修改时间', type: 'date' }
  }
  return { id: CREATED_AT_FIELD_ID, name: '创建时间', type: 'date' }
}

/** 筛选面板可用的字段：用户字段 + 两个系统时间列 */
export function filterableFields(fields: FieldDef[]): FieldDef[] {
  return [...fields, systemField(CREATED_AT_FIELD_ID), systemField(UPDATED_AT_FIELD_ID)]
}

/** 按字段类型派生可用操作符 */
export function opsForField(f: FieldDef): Array<{ op: FilterOp; label: string }> {
  if (f.id === CREATED_AT_FIELD_ID || f.id === UPDATED_AT_FIELD_ID) {
    // 系统时间列恒有值，没有「为空」语义
    return [
      { op: 'today', label: '今天' },
      { op: 'thisWeek', label: '本周' },
      { op: 'thisMonth', label: '本月' }
    ]
  }
  const list: Array<{ op: FilterOp; label: string }> = [
    { op: 'empty', label: '为空' },
    { op: 'notEmpty', label: '不为空' }
  ]
  if (f.type === 'select' || f.type === 'multi_select' || f.type === 'list') {
    list.push({ op: 'eq', label: '属于选项' })
  }
  if (
    f.type === 'text' ||
    f.type === 'longtext' ||
    f.type === 'url' ||
    f.type === 'select' ||
    f.type === 'number'
  ) {
    list.push({ op: 'contains', label: '包含' })
  }
  if (f.type === 'date') {
    list.push({ op: 'today', label: '今天' }, { op: 'thisWeek', label: '本周' }, { op: 'thisMonth', label: '本月' })
  }
  return list
}

/** 空值判定：null / '' / 空数组算空；checkbox 的 false 是有效值不算空 */
export function isEmptyValue(f: FieldDef, v: unknown): boolean {
  if (f.type === 'checkbox') return false
  if (v == null) return true
  if (Array.isArray(v)) return v.length === 0
  return String(v) === ''
}

/**
 * date 字段存 'YYYY-MM-DD'；Date.parse 会按 UTC 解析差 8 小时，
 * 必须手动拆解成本地时区的当天 00:00。
 */
export function parseLocalDate(s: string): number | null {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s.trim())
  if (!m) return null
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
  return Number.isFinite(t) ? t : null
}

function dayStart(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 本周 = 周一起始：[周一 00:00, 下周一 00:00) */
export function weekRange(now: number): [number, number] {
  const d = new Date(dayStart(now))
  const dow = d.getDay() === 0 ? 7 : d.getDay() // 周日=0 视为第 7 天
  d.setDate(d.getDate() - (dow - 1))
  const start = d.getTime()
  return [start, start + 7 * 86400_000]
}

export function monthRange(now: number): [number, number] {
  const d = new Date(now)
  const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
  return [start, end]
}

function timeRangeOf(op: FilterOp, now: number): [number, number] | null {
  if (op === 'today') {
    const start = dayStart(now)
    return [start, start + 86400_000]
  }
  if (op === 'thisWeek') return weekRange(now)
  if (op === 'thisMonth') return monthRange(now)
  return null
}

/** 取行里某字段的可比较时间戳；无值返回 null */
function rowTimestamp(f: FieldDef, row: { createdAt: number; updatedAt: number; values: Record<string, unknown> }): number | null {
  if (f.id === CREATED_AT_FIELD_ID) return row.createdAt || null
  if (f.id === UPDATED_AT_FIELD_ID) return row.updatedAt || null
  const raw = row.values[f.id]
  if (raw == null || raw === '') return null
  return parseLocalDate(String(raw))
}

/** 单条件匹配（now 供时间条件计算范围，测试可注入固定时间） */
export function matchCond(
  cond: FilterCond,
  row: { createdAt: number; updatedAt: number; values: Record<string, unknown> },
  fields: FieldDef[],
  now: number,
  multiSep = '、'
): boolean {
  const f =
    cond.fieldId === CREATED_AT_FIELD_ID
      ? systemField(CREATED_AT_FIELD_ID)
      : cond.fieldId === UPDATED_AT_FIELD_ID
        ? systemField(UPDATED_AT_FIELD_ID)
        : fields.find((x) => x.id === cond.fieldId)
  if (!f) return true // 字段已被删掉：条件失效但不拦人，避免「筛出 0 行还找不到原因」

  if (cond.op === 'empty' || cond.op === 'notEmpty') {
    const empty = isEmptyValue(f, f.id in row.values ? row.values[f.id] : null)
    // 系统时间列恒有值；date 字段走同一套空值判定
    return cond.op === 'empty' ? empty : !empty
  }

  if (cond.op === 'today' || cond.op === 'thisWeek' || cond.op === 'thisMonth') {
    const ts = rowTimestamp(f, row)
    if (ts == null) return false
    const range = timeRangeOf(cond.op, now)
    if (!range) return false
    return ts >= range[0] && ts < range[1]
  }

  if (cond.op === 'eq') {
    const want = cond.value
    const v = row.values[f.id]
    if (Array.isArray(v)) return v.includes(want)
    return String(v ?? '') === want
  }

  // contains：用展示文本比（多值用分隔符拼起来），大小写不敏感
  const hay = displayValue(f, (row.values[f.id] ?? null) as never, multiSep).toLowerCase()
  return hay.includes(cond.value.trim().toLowerCase())
}

/** 整组条件（AND）是否匹配 */
export function matchAll(
  conds: FilterCond[],
  row: { id: string; createdAt: number; updatedAt: number; values: Record<string, unknown> },
  fields: FieldDef[],
  now: number,
  multiSep = '、'
): boolean {
  return conds.every((c) => matchCond(c, row, fields, now, multiSep))
}
