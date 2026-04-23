// offset.js — 主键 ID 偏移
'use strict'

const { parseInsertLine, splitMultiRowInsert, quoteTableName } = require('./dedupe')
const { splitStatements } = require('./segment')

function offsetSql(sql, rules) {
  if (!rules || rules.length === 0) return { sql, modifiedCount: 0, skippedCount: 0, warnings: [] }

  const lines = splitStatements(sql).flatMap(splitMultiRowInsert)
  let modifiedCount = 0
  let skippedCount = 0
  const warningSet = new Set()

  const outputLines = lines.map((line) => {
    const trimmed = line.trimEnd()
    if (!/^INSERT\s+INTO\s+/i.test(trimmed)) return trimmed
    const parsed = parseInsertLine(trimmed)
    if (!parsed) return trimmed

    const { tableName, columns, values } = parsed
    const newValues = [...values]
    let modified = false
    const skippedCols = []

    for (const rule of rules) {
      let idx = -1
      if (rule.column && columns) {
        idx = columns.findIndex((c) => c.toLowerCase() === rule.column.toLowerCase())
      } else if (rule.colIndex !== undefined) {
        idx = rule.colIndex - 1
      }
      if (idx === -1 || idx >= newValues.length) continue

      const raw = newValues[idx]
      const num = Number(raw)
      if (!Number.isFinite(num) || raw.startsWith("'")) {
        skippedCols.push(rule.column || `col${idx + 1}`)
        continue
      }
      newValues[idx] = String(num + rule.offset)
      modified = true
    }

    if (skippedCols.length > 0) {
      skippedCount++
      skippedCols.forEach((c) => warningSet.add(`列 "${c}" 存在非数值，已跳过偏移`))
    }
    if (!modified) return trimmed

    modifiedCount++
    const colPart = columns !== null
      ? ` (${columns.map((c) => `\`${c}\``).join(', ')})`
      : ''
    return `INSERT INTO ${quoteTableName(tableName)}${colPart} VALUES (${newValues.join(', ')});`
  })

  while (outputLines.length > 0 && outputLines[outputLines.length - 1].trim() === '') {
    outputLines.pop()
  }

  return { sql: outputLines.join('\n'), modifiedCount, skippedCount, warnings: Array.from(warningSet) }
}

module.exports = { offsetSql }
