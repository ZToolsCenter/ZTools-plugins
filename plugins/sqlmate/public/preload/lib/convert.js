// convert.js — SQL ↔ CSV/Excel 互转（Node.js 版）
// SQL → CSV / xlsx：parseInsertToRows + toCsv + toXlsx
// CSV → SQL：csvToSql
// Excel → SQL：xlsxToSql
'use strict'

const fs   = require('node:fs')
const path = require('node:path')
const XLSX = require('xlsx')

// ─── SQL → 结构化行数据 ───────────────────────────────────────────────────────

const INSERT_HDR_RE =
  /INSERT\s+(?:LOW_PRIORITY\s+|DELAYED\s+|HIGH_PRIORITY\s+|IGNORE\s+)?INTO\s+((?:`[^`]+`|\w+)(?:\.(?:`[^`]+`|\w+))?)\s*(\([^)]*\))?\s*VALUES\s*/i

function normalizeTableName(raw) {
  const stripped = raw.replace(/`/g, '')
  const parts = stripped.split('.')
  return parts[parts.length - 1] ?? ''
}

function parseColumns(colStr) {
  return colStr.slice(1, -1).split(',').map((c) => c.trim().replace(/`/g, ''))
}

function parseSqlValue(raw) {
  const t = raw.trim()
  if (t.toUpperCase() === 'NULL') return ''
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) {
    return t.slice(1, -1).replace(/''/g, "'").replace(/\\'/g, "'")
  }
  return t
}

function splitTupleTokens(tuple) {
  const inner = tuple.startsWith('(') && tuple.endsWith(')') ? tuple.slice(1, -1) : tuple
  const tokens = []
  let depth = 0, inStr = false, start = 0
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (inStr) {
      if (ch === '\\') { i++; continue }
      if (ch === "'" && inner[i + 1] === "'") { i++; continue }
      if (ch === "'") inStr = false
    } else {
      if (ch === "'") inStr = true
      else if (ch === '(') depth++
      else if (ch === ')') depth--
      else if (ch === ',' && depth === 0) {
        tokens.push(inner.slice(start, i).trim())
        start = i + 1
      }
    }
  }
  tokens.push(inner.slice(start).trim())
  return tokens
}

function processStatement(stmt, tableMap) {
  const match = INSERT_HDR_RE.exec(stmt)
  if (!match) return
  const tableName = normalizeTableName(match[1])
  const colStr = match[2] ?? ''
  const valuesOffset = match.index + match[0].length
  const valuesRaw = stmt.slice(valuesOffset).replace(/[;\s]+$/, '').trim()

  if (!tableMap.has(tableName)) {
    const columns = colStr ? parseColumns(colStr) : []
    tableMap.set(tableName, { tableName, columns, rows: [] })
  }
  const td = tableMap.get(tableName)

  let depth = 0, inStr = false, tupleStart = -1
  for (let i = 0; i < valuesRaw.length; i++) {
    const ch = valuesRaw[i]
    if (inStr) {
      if (ch === '\\') { i++; continue }
      if (ch === "'" && valuesRaw[i + 1] === "'") { i++; continue }
      if (ch === "'") inStr = false
    } else {
      if (ch === "'") { inStr = true }
      else if (ch === '(') { if (depth === 0) tupleStart = i; depth++ }
      else if (ch === ')') {
        depth--
        if (depth === 0 && tupleStart !== -1) {
          const tuple = valuesRaw.slice(tupleStart, i + 1)
          const tokens = splitTupleTokens(tuple).map(parseSqlValue)
          if (td.columns.length === 0 && td.rows.length === 0) {
            td.columns = tokens.map((_, idx) => `col${idx + 1}`)
          }
          td.rows.push(tokens)
          tupleStart = -1
        }
      }
    }
  }
}

/**
 * 解析 SQL 中所有 INSERT 语句为结构化行数据
 * @param {string} sql
 * @returns {{ tableName: string, columns: string[], rows: string[][] }[]}
 */
function parseInsertToRows(sql) {
  const tableMap = new Map()
  const lines = sql.split('\n')
  let buf = ''
  for (const line of lines) {
    buf += line.replace(/\r$/, '') + '\n'
    if (line.trimEnd().endsWith(';')) {
      const stmt = buf.trim()
      buf = ''
      if (stmt) processStatement(stmt, tableMap)
    }
  }
  const remaining = buf.trim()
  if (remaining) processStatement(remaining, tableMap)
  return Array.from(tableMap.values())
}

// ─── SQL → CSV ────────────────────────────────────────────────────────────────

function csvEscape(val) {
  if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
    return '"' + val.replace(/"/g, '""') + '"'
  }
  return val
}

function toCsvText(table) {
  const lines = []
  if (table.columns.length > 0) lines.push(table.columns.map(csvEscape).join(','))
  for (const row of table.rows) lines.push(row.map(csvEscape).join(','))
  return lines.join('\r\n')
}

/**
 * SQL → CSV 文件（单表）或多个 CSV 文件（多表写到目录）
 * @param {string} sql
 * @param {string} outputPath  单表时为文件路径；多表时为目录路径
 * @returns {{ tableCount: number, rowCount: number, files: string[] }}
 */
function sqlToCsv(sql, outputPath) {
  const tables = parseInsertToRows(sql)
  if (tables.length === 0) throw new Error('未找到 INSERT 语句')

  const files = []
  if (tables.length === 1) {
    // 单表 → 直接写到 outputPath
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, toCsvText(tables[0]), 'utf-8')
    files.push(outputPath)
  } else {
    // 多表 → 写到目录，每表一个文件
    fs.mkdirSync(outputPath, { recursive: true })
    for (const table of tables) {
      const filePath = path.join(outputPath, `${table.tableName}.csv`)
      fs.writeFileSync(filePath, toCsvText(table), 'utf-8')
      files.push(filePath)
    }
  }

  const rowCount = tables.reduce((sum, t) => sum + t.rows.length, 0)
  return { tableCount: tables.length, rowCount, files }
}

// ─── SQL → xlsx ───────────────────────────────────────────────────────────────

/**
 * SQL → xlsx 文件（多表 → 多 Sheet）
 * @param {string} sql
 * @param {string} outputPath  .xlsx 文件路径
 * @returns {{ tableCount: number, rowCount: number }}
 */
function sqlToXlsx(sql, outputPath) {
  const tables = parseInsertToRows(sql)
  if (tables.length === 0) throw new Error('未找到 INSERT 语句')

  const wb = XLSX.utils.book_new()
  for (const table of tables) {
    const data = [table.columns, ...table.rows]
    const ws = XLSX.utils.aoa_to_sheet(data)
    XLSX.utils.book_append_sheet(wb, ws, table.tableName.slice(0, 31))
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  XLSX.writeFile(wb, outputPath)

  const rowCount = tables.reduce((sum, t) => sum + t.rows.length, 0)
  return { tableCount: tables.length, rowCount }
}

// ─── CSV → SQL ────────────────────────────────────────────────────────────────

const NUMERIC_RE = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/

function parseCsvRow(row) {
  const fields = []
  let i = 0, lastWasSeparator = false
  while (i < row.length) {
    if (row[i] === '"') {
      i++
      let val = ''
      while (i < row.length) {
        if (row[i] === '"' && row[i + 1] === '"') { val += '"'; i += 2 }
        else if (row[i] === '"') { i++; break }
        else { val += row[i++] }
      }
      fields.push(val)
      if (row[i] === ',') { i++; lastWasSeparator = true } else { lastWasSeparator = false }
    } else {
      const commaIdx = row.indexOf(',', i)
      if (commaIdx === -1) { fields.push(row.slice(i)); lastWasSeparator = false; break }
      else { fields.push(row.slice(i, commaIdx)); i = commaIdx + 1; lastWasSeparator = true }
    }
  }
  if (lastWasSeparator) fields.push('')
  return fields
}

/**
 * CSV 文本 → SQL INSERT 语句
 * @param {string} csvText
 * @param {{ tableName: string, noHeader?: boolean, batchSize?: number, detectNumeric?: boolean }} options
 * @returns {string}
 */
function csvToSql(csvText, options) {
  const { tableName, noHeader = false, batchSize = 0, detectNumeric = true } = options
  const text = csvText.replace(/^\uFEFF/, '')
  const lines = text.split(/\r?\n/)
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()

  const safeTable = tableName.replace(/`/g, '')
  let headers, dataLines

  if (noHeader) {
    if (lines.length < 1) return ''
    const colCount = parseCsvRow(lines[0]).length
    headers = Array.from({ length: colCount }, (_, i) => `col${i + 1}`)
    dataLines = lines
  } else {
    if (lines.length < 2) return ''
    headers = parseCsvRow(lines[0])
    dataLines = lines.slice(1)
  }

  const colList = headers.map((h) => `\`${h.replace(/`/g, '')}\``).join(', ')
  const allRows = []
  for (const line of dataLines) {
    if (!line.trim()) continue
    const values = parseCsvRow(line)
    while (values.length < headers.length) values.push('')
    allRows.push(values.slice(0, headers.length))
  }
  if (allRows.length === 0) return ''

  const isNumeric = headers.map((_, ci) => {
    if (!detectNumeric) return false
    return allRows.every((row) => row[ci] === '' || NUMERIC_RE.test(row[ci]))
  })

  const fmtVal = (val, ci) => {
    if (val === '') return 'NULL'
    if (isNumeric[ci]) return val
    return `'${val.replace(/'/g, "''")}'`
  }

  const stmts = []
  const size = batchSize > 0 ? batchSize : 0
  if (!size) {
    for (const row of allRows) {
      stmts.push(`INSERT INTO \`${safeTable}\` (${colList}) VALUES (${row.map(fmtVal).join(', ')});`)
    }
  } else {
    for (let i = 0; i < allRows.length; i += size) {
      const batch = allRows.slice(i, i + size)
      const rowClauses = batch.map((row) => `  (${row.map(fmtVal).join(', ')})`).join(',\n')
      stmts.push(`INSERT INTO \`${safeTable}\` (${colList}) VALUES\n${rowClauses};`)
    }
  }
  return stmts.join('\n')
}

// ─── Excel → SQL ──────────────────────────────────────────────────────────────

/**
 * xlsx 文件 → SQL INSERT 语句（多 Sheet → 多表，Sheet 名作为表名）
 * @param {string} filePath
 * @param {{ noHeader?: boolean, batchSize?: number, detectNumeric?: boolean, tableNameOverride?: string }} options
 * @returns {{ sql: string, tableCount: number, rowCount: number }}
 */
function xlsxToSql(filePath, options = {}) {
  const { noHeader = false, batchSize = 0, detectNumeric = true, tableNameOverride } = options
  const wb = XLSX.readFile(filePath)
  const allSql = []
  let totalRows = 0

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    const tableName = tableNameOverride || sheetName.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_')

    // 转为二维数组
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    if (aoa.length === 0) continue

    let headers, dataRows
    if (noHeader) {
      const colCount = aoa[0].length
      headers = Array.from({ length: colCount }, (_, i) => `col${i + 1}`)
      dataRows = aoa
    } else {
      headers = aoa[0].map((h) => String(h))
      dataRows = aoa.slice(1)
    }

    const colList = headers.map((h) => `\`${String(h).replace(/`/g, '')}\``).join(', ')
    const safeTable = tableName.replace(/`/g, '')

    // 数值列检测
    const isNumeric = headers.map((_, ci) => {
      if (!detectNumeric) return false
      return dataRows.every((row) => {
        const v = row[ci]
        return v === '' || v === null || v === undefined || NUMERIC_RE.test(String(v))
      })
    })

    const fmtVal = (val, ci) => {
      if (val === '' || val === null || val === undefined) return 'NULL'
      const s = String(val)
      if (isNumeric[ci]) return s
      return `'${s.replace(/'/g, "''")}'`
    }

    const size = batchSize > 0 ? batchSize : 0
    if (!size) {
      for (const row of dataRows) {
        const vals = headers.map((_, ci) => fmtVal(row[ci], ci)).join(', ')
        allSql.push(`INSERT INTO \`${safeTable}\` (${colList}) VALUES (${vals});`)
        totalRows++
      }
    } else {
      for (let i = 0; i < dataRows.length; i += size) {
        const batch = dataRows.slice(i, i + size)
        const rowClauses = batch.map((row) =>
          `  (${headers.map((_, ci) => fmtVal(row[ci], ci)).join(', ')})`
        ).join(',\n')
        allSql.push(`INSERT INTO \`${safeTable}\` (${colList}) VALUES\n${rowClauses};`)
        totalRows += batch.length
      }
    }
  }

  return { sql: allSql.join('\n\n'), tableCount: wb.SheetNames.length, rowCount: totalRows }
}

module.exports = {
  parseInsertToRows,
  sqlToCsv,
  sqlToXlsx,
  csvToSql,
  xlsxToSql,
}
