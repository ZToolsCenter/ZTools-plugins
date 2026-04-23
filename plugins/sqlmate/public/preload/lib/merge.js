// merge.js — 合并多条单行 INSERT 为批量 INSERT
'use strict'

function parseInserts(sql) {
  const pattern =
    /INSERT\s+INTO\s+(`?\w+`?)\s*(\([^)]*\))?\s*VALUES\s*(\((?:[^)(']|'(?:[^'\\]|\\.)*'|\((?:[^)(']|'(?:[^'\\]|\\.)*')*\))*\))/gi
  const results = []
  let match
  while ((match = pattern.exec(sql)) !== null) {
    const tableName = match[1]
    const columns = match[2] ?? ''
    results.push({
      tableKey: `${tableName}|${columns}`,
      tableName,
      columns,
      values: match[3],
    })
  }
  return results
}

function mergeSQL(sql, options) {
  const { batchSize = 1000 } = options || {}
  if (!sql.trim()) return { sql: '', tableCount: 0, statementCount: 0 }

  const inserts = parseInserts(sql)
  const groups = new Map()

  for (const ins of inserts) {
    if (!groups.has(ins.tableKey)) {
      groups.set(ins.tableKey, { tableName: ins.tableName, columns: ins.columns, values: [] })
    }
    groups.get(ins.tableKey).values.push(ins.values)
  }

  const statements = []
  for (const group of groups.values()) {
    const colPart = group.columns ? ` ${group.columns}` : ''
    for (let i = 0; i < group.values.length; i += batchSize) {
      const batch = group.values.slice(i, i + batchSize)
      statements.push(`INSERT INTO ${group.tableName}${colPart} VALUES\n${batch.join(',\n')};`)
    }
  }

  return {
    sql: statements.join('\n\n'),
    tableCount: groups.size,
    statementCount: statements.length,
  }
}

module.exports = { mergeSQL }
