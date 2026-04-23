// segment.js — 按行数或大小分割 SQL 文本
'use strict'

function fileName(index) {
  return `output_${String(index).padStart(3, '0')}.sql`
}

function parseStatements(sql) {
  return sql
    .split(/;\s*\n?/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s + ';')
}

function segmentSQL(sql, options) {
  const { mode, count = 10000, sizeMB = 10 } = options || {}
  const statements = parseStatements(sql)
  const files = []

  if (mode === 'count') {
    for (let i = 0; i < statements.length; i += count) {
      const chunk = statements.slice(i, i + count)
      files.push({ name: fileName(files.length + 1), content: chunk.join('\n') })
    }
  } else {
    const maxBytes = sizeMB * 1024 * 1024
    let current = []
    let currentSize = 0
    for (const stmt of statements) {
      const stmtSize = Buffer.byteLength(stmt, 'utf8')
      if (currentSize + stmtSize > maxBytes && current.length > 0) {
        files.push({ name: fileName(files.length + 1), content: current.join('\n') })
        current = []
        currentSize = 0
      }
      current.push(stmt)
      currentSize += stmtSize
    }
    if (current.length > 0) {
      files.push({ name: fileName(files.length + 1), content: current.join('\n') })
    }
  }

  return { files, fileCount: files.length }
}

module.exports = { segmentSQL }
