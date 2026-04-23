// extract.js — 扫描表名 / 按表名抽取 INSERT
'use strict'

const INSERT_RE =
  /INSERT\s+(?:LOW_PRIORITY\s+|DELAYED\s+|HIGH_PRIORITY\s+|IGNORE\s+)?INTO\s+((?:`[^`]+`|\w+)(?:\.(?:`[^`]+`|\w+))?)/i

function makeInsertRe() {
  return new RegExp(INSERT_RE.source, 'gi')
}

function normalizeTableName(raw) {
  const stripped = raw.replace(/`/g, '')
  const parts = stripped.split('.')
  return (parts[parts.length - 1] ?? '').toLowerCase()
}

function scanTables(sql) {
  const counts = new Map()
  const re = makeInsertRe()
  let match
  while ((match = re.exec(sql)) !== null) {
    const name = normalizeTableName(match[1])
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return Array.from(counts.entries()).map(([name, count]) => ({ name, count }))
}

function extractTables(sql, tables) {
  const targetSet = new Set(tables.map((t) => t.toLowerCase().trim()))
  const lines = sql.split('\n')
  const results = []
  let buf = ''

  const tryAppend = (stmt) => {
    const m = INSERT_RE.exec(stmt)
    if (m && targetSet.has(normalizeTableName(m[1]))) {
      results.push(stmt)
    }
  }

  for (const line of lines) {
    buf += line.replace(/\r$/, '') + '\n'
    if (line.trimEnd().endsWith(';')) {
      const stmt = buf.trim()
      buf = ''
      if (stmt) tryAppend(stmt)
    }
  }
  const remaining = buf.trim()
  if (remaining) tryAppend(remaining)

  return { sql: results.join('\n'), count: results.length }
}

module.exports = { scanTables, extractTables }
