// convert_stmt.js — INSERT 改写为 UPDATE / UPSERT / INSERT IGNORE
'use strict'

const { parseInsertLine, splitMultiRowInsert } = require('./dedupe')

function buildSetClause(columns, values, pkIdx, excludeSet) {
  return columns
    .map((col, i) => {
      if (i === pkIdx) return null
      if (excludeSet.has(col.toLowerCase())) return null
      return `\`${col}\` = ${values[i] ?? 'NULL'}`
    })
    .filter(Boolean)
    .join(', ')
}

function convertLine(line, options) {
  const parsed = parseInsertLine(line)
  if (!parsed) return null
  const { tableName, columns, values } = parsed
  const { pkColumn, pkColIndex, mode, excludeColumns = [] } = options
  const excludeSet = new Set(excludeColumns.map((c) => c.toLowerCase()))

  let pkIdx = -1
  if (pkColumn && columns) {
    pkIdx = columns.findIndex((c) => c.toLowerCase() === pkColumn.toLowerCase())
  } else if (pkColIndex !== undefined) {
    pkIdx = pkColIndex - 1
  }
  if (pkIdx === -1 || pkIdx >= values.length) return null

  const pkVal = values[pkIdx]

  if (mode === 'update') {
    if (!columns) return null
    const setClause = buildSetClause(columns, values, pkIdx, excludeSet)
    if (!setClause) return null
    const pkColName = columns[pkIdx]
    return `UPDATE \`${tableName}\` SET ${setClause} WHERE \`${pkColName}\` = ${pkVal};`
  }

  if (mode === 'mysql_upsert') {
    const colList = columns ? `(${columns.map((c) => `\`${c}\``).join(', ')}) ` : ''
    const valList = values.join(', ')
    const updatePart = columns
      ? columns.map((col, i) => {
          if (i === pkIdx) return null
          if (excludeSet.has(col.toLowerCase())) return null
          return `\`${col}\` = VALUES(\`${col}\`)`
        }).filter(Boolean).join(', ')
      : '/* specify columns */'
    return `INSERT INTO \`${tableName}\` ${colList}VALUES (${valList}) ON DUPLICATE KEY UPDATE ${updatePart};`
  }

  if (mode === 'pg_upsert') {
    const colList = columns ? `(${columns.map((c) => `"${c}"`).join(', ')}) ` : ''
    const valList = values.join(', ')
    const pkColName = columns ? `"${columns[pkIdx]}"` : `col${pkIdx + 1}`
    const updatePart = columns
      ? columns.map((col, i) => {
          if (i === pkIdx) return null
          if (excludeSet.has(col.toLowerCase())) return null
          return `"${col}" = EXCLUDED."${col}"`
        }).filter(Boolean).join(', ')
      : '/* specify columns */'
    return `INSERT INTO "${tableName}" ${colList}VALUES (${valList}) ON CONFLICT (${pkColName}) DO UPDATE SET ${updatePart};`
  }

  return null
}

function convertStatements(sql, options) {
  const lines = sql.split('\n').flatMap(splitMultiRowInsert)
  let convertedCount = 0
  let skippedCount = 0

  const outputLines = lines.map((line) => {
    const trimmed = line.trimEnd()
    if (!/INSERT/i.test(trimmed)) return trimmed

    if (options.mode === 'insert_ignore') {
      if (/INSERT\s+IGNORE\b/i.test(trimmed)) return trimmed
      const replaced = trimmed.replace(
        /INSERT(\s+(?:LOW_PRIORITY|DELAYED|HIGH_PRIORITY))?\s+INTO\b/i,
        (_, mod) => `INSERT${mod ?? ''} IGNORE INTO`
      )
      if (replaced !== trimmed) { convertedCount++; return replaced }
      return trimmed
    }

    if (!/^INSERT\s+INTO\s+/i.test(trimmed)) return trimmed
    const converted = convertLine(trimmed, options)
    if (converted !== null) { convertedCount++; return converted }
    skippedCount++
    return trimmed
  })

  while (outputLines.length > 0 && outputLines[outputLines.length - 1].trim() === '') {
    outputLines.pop()
  }

  return { sql: outputLines.join('\n'), convertedCount, skippedCount }
}

module.exports = { convertStatements }
