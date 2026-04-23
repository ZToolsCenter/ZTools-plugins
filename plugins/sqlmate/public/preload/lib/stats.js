// stats.js — SQL 文件统计分析
'use strict'

function analyzeSql(sql) {
  const start = Date.now()
  const inputBytes = Buffer.byteLength(sql, 'utf8')
  const tableMap = new Map()
  let totalStatements = 0

  for (const line of sql.split('\n')) {
    const trimmed = line.trimEnd()
    const m = trimmed.match(/^INSERT\s+INTO\s+`?([^`\s(]+)`?/i)
    if (!m) continue
    totalStatements++
    const tableName = m[1]
    const lineBytes = Buffer.byteLength(trimmed, 'utf8')
    const existing = tableMap.get(tableName)
    if (existing) {
      existing.rowCount++
      existing.bytes += lineBytes
    } else {
      tableMap.set(tableName, { rowCount: 1, bytes: lineBytes })
    }
  }

  const tables = Array.from(tableMap.entries()).map(([tableName, { rowCount, bytes }]) => ({
    tableName,
    rowCount,
    estimatedBytes: bytes,
  }))

  return {
    tables,
    totalRows: totalStatements,
    totalStatements,
    inputBytes,
    durationMs: Date.now() - start,
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function statsToMarkdown(stats) {
  const header = '| 表名 | 行数 | 估算大小 |\n|------|------|----------|\n'
  const rows = stats.tables
    .map((t) => `| ${t.tableName} | ${t.rowCount.toLocaleString()} | ${formatBytes(t.estimatedBytes)} |`)
    .join('\n')
  return header + rows
}

function statsToCsv(stats) {
  const header = 'table_name,row_count,estimated_bytes\n'
  const rows = stats.tables.map((t) => `${t.tableName},${t.rowCount},${t.estimatedBytes}`).join('\n')
  return header + rows
}

module.exports = { analyzeSql, formatBytes, statsToMarkdown, statsToCsv }
