import type { FieldDef, FieldValue, Row, TableSchema } from '../../types/table.ts'
import { CREATED_AT_FIELD_ID, UPDATED_AT_FIELD_ID, isMultiValue } from '../../types/table.ts'
import { coerceFieldValue, displayValue, initialFieldDefault } from '../fieldTypes.ts'
import { encodeCsv, encodeTsv, parseCsv, parseDelimited, parseTsv } from './tsv.ts'
import { DEFAULT_MULTI_SEP, splitMultiValue } from '../separators.ts'
import { formatTimestamp } from '../../utils/time.ts'

export { DEFAULT_MULTI_SEP }

export function joinMulti(values: string[], sep = DEFAULT_MULTI_SEP): string {
  return values.join(sep)
}

/** 导入拆多值：统一 、 ， , | */
export function splitMulti(text: string): string[] {
  return splitMultiValue(text)
}

export function formatCell(
  field: FieldDef,
  value: FieldValue | undefined,
  multiSep = DEFAULT_MULTI_SEP
): string {
  // 导出/展示兜底：缺失值显示为空，不编造字段默认值
  return displayValue(field, value ?? null, multiSep)
}

function cellForRow(field: FieldDef, row: Row, multiSep: string): string {
  if (field.id === CREATED_AT_FIELD_ID) return formatTimestamp(row.createdAt)
  if (field.id === UPDATED_AT_FIELD_ID) return formatTimestamp(row.updatedAt)
  return formatCell(field, row.values[field.id], multiSep)
}

export function rowsToMatrix(
  fields: FieldDef[],
  rows: Row[],
  opts: { includeHeader?: boolean; multiSep?: string } = {}
): string[][] {
  const { includeHeader = true, multiSep = DEFAULT_MULTI_SEP } = opts
  const matrix: string[][] = []
  if (includeHeader) matrix.push(fields.map((f) => f.name))
  for (const row of rows) {
    matrix.push(fields.map((f) => cellForRow(f, row, multiSep)))
  }
  return matrix
}

export function rowsToTsv(
  fields: FieldDef[],
  rows: Row[],
  opts: { includeHeader?: boolean; multiSep?: string } = {}
): string {
  return encodeTsv(rowsToMatrix(fields, rows, opts))
}

export function rowsToCsv(
  fields: FieldDef[],
  rows: Row[],
  opts: { includeHeader?: boolean; multiSep?: string } = {}
): string {
  return encodeCsv(rowsToMatrix(fields, rows, opts))
}

export type ParseKind = 'tsv' | 'csv' | 'auto'

export function parseTableText(text: string, kind: ParseKind = 'auto'): string[][] {
  const body = text.startsWith('﻿') ? text.slice(1) : text
  if (kind === 'tsv') return parseTsv(body)
  if (kind === 'csv') return parseCsv(body)
  // auto：优先看首行分隔符数量
  const firstLine = body.split(/\r?\n/, 1)[0] ?? ''
  const tabs = (firstLine.match(/\t/g) ?? []).length
  const commas = (firstLine.match(/,/g) ?? []).length
  if (tabs === 0 && commas > 0) return parseCsv(body)
  if (tabs > 0) return parseTsv(body)
  if (commas > 0) return parseCsv(body)
  return parseDelimited(body, '\t')
}

export function parseImportText(text: string): { headers: string[]; dataRows: string[][] } {
  const matrix = parseTableText(text, 'auto')
  if (matrix.length === 0) return { headers: [], dataRows: [] }
  const headers = matrix[0].map((h) => h.trim())
  const dataRows = matrix.slice(1).filter((r) => r.some((c) => c.trim() !== ''))
  return { headers, dataRows }
}

/** 按列映射把一行文本转成 values；未知列忽略。 */
export function mapRowValues(
  fields: FieldDef[],
  headers: string[],
  cells: string[],
  columnMap: Record<number, string | null>,
  multiSep = DEFAULT_MULTI_SEP
): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {}
  for (const f of fields) values[f.id] = initialFieldDefault(f)

  for (let col = 0; col < headers.length; col += 1) {
    const fieldId = columnMap[col]
    if (!fieldId) continue
    const field = fields.find((f) => f.id === fieldId)
    if (!field) continue
    const raw = cells[col] ?? ''
    if (isMultiValue(field)) {
      const list = splitMulti(raw)
      values[field.id] = list
    } else {
      values[field.id] = coerceFieldValue(field, raw)
    }
  }
  // multiSep 仅用于导出展示；导入以 splitMulti 为准
  void multiSep
  return values
}

/** 按字段名自动匹配表头 → 列映射 */
export function autoColumnMap(
  fields: FieldDef[],
  headers: string[]
): Record<number, string | null> {
  const map: Record<number, string | null> = {}
  const used = new Set<string>()
  headers.forEach((h, i) => {
    const name = h.trim().toLowerCase()
    const hit = fields.find(
      (f) => !used.has(f.id) && f.name.trim().toLowerCase() === name
    )
    if (hit) {
      map[i] = hit.id
      used.add(hit.id)
    } else {
      map[i] = null
    }
  })
  return map
}
