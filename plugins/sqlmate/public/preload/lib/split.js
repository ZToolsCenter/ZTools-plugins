// split.js — 拆分批量 INSERT 为单行
'use strict'

function extractValueGroups(valuesBlock) {
  const groups = []
  let depth = 0
  let start = -1
  let inString = false
  let stringChar = ''

  for (let i = 0; i < valuesBlock.length; i++) {
    const ch = valuesBlock[i]
    if (!inString && (ch === "'" || ch === '"')) {
      inString = true
      stringChar = ch
    } else if (inString && ch === stringChar && valuesBlock[i - 1] !== '\\') {
      inString = false
    } else if (!inString) {
      if (ch === '(') {
        if (depth === 0) start = i
        depth++
      } else if (ch === ')') {
        depth--
        if (depth === 0 && start !== -1) {
          groups.push(valuesBlock.slice(start, i + 1))
        }
      }
    }
  }
  return groups
}

function splitSQL(sql) {
  if (!sql.trim()) return { sql: '', statementCount: 0 }

  const pattern =
    /INSERT\s+INTO\s+(`?\w+`?)\s*(\([^)]*\))?\s*VALUES\s*([\s\S]+?)(?=;|$)/gi

  const statements = []
  let match

  while ((match = pattern.exec(sql)) !== null) {
    const tableName = match[1]
    const columns = match[2] ?? ''
    const colPart = columns ? ` ${columns}` : ''
    const groups = extractValueGroups(match[3])
    for (const group of groups) {
      statements.push(`INSERT INTO ${tableName}${colPart} VALUES ${group};`)
    }
  }

  return { sql: statements.join('\n'), statementCount: statements.length }
}

module.exports = { splitSQL }
