// ddl_diff.js — DDL 结构对比 + ALTER SQL 生成
'use strict'

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

function normaliseIdent(raw) {
  return raw.replace(/^[`"[\]]|[`"[\]]$/g, '').toLowerCase().trim()
}

function splitCreateTableBody(body) {
  const items = []
  let depth = 0
  let current = ''
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '(') { depth++; current += ch }
    else if (ch === ')') { depth--; current += ch }
    else if (ch === ',' && depth === 0) {
      const trimmed = current.trim()
      if (trimmed) items.push(trimmed)
      current = ''
    } else { current += ch }
  }
  const trimmed = current.trim()
  if (trimmed) items.push(trimmed)
  return items
}

function extractIndexColumns(item) {
  const m = item.match(/\(([^)]+)\)/)
  if (!m) return []
  return m[1].split(',').map((c) => {
    const bare = c.trim().replace(/\s*\(\d+\)\s*$/, '')
    return normaliseIdent(bare)
  })
}

function extractIndexName(item, prefixRe) {
  const rest = item.trimStart().replace(prefixRe, '')
  const m = rest.match(/^(`[^`]+`|"[^"]+"|[\w$]+)/)
  if (!m) return { name: 'unnamed', rawName: 'unnamed' }
  return { name: normaliseIdent(m[1]), rawName: m[1] }
}

function parseDDL(sql) {
  const cleaned = stripComments(sql)
  const createRe = /CREATE\s+(?:TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(`[^`]+`|"[^"]+"|[\w$]+)/gi
  const matches = [...cleaned.matchAll(createRe)]

  if (matches.length === 0) throw new Error('未找到 CREATE TABLE 语句，请输入有效的 DDL')
  if (matches.length > 1) throw new Error('检测到多个 CREATE TABLE，请只输入一张表的 DDL')

  const rawTableName = matches[0][1]
  const tableName = normaliseIdent(rawTableName)

  const startIdx = cleaned.indexOf('(', matches[0].index)
  if (startIdx === -1) throw new Error("CREATE TABLE 语句格式不正确：缺少 '('")

  let depth = 0, endIdx = -1
  for (let i = startIdx; i < cleaned.length; i++) {
    if (cleaned[i] === '(') depth++
    else if (cleaned[i] === ')') { depth--; if (depth === 0) { endIdx = i; break } }
  }
  if (endIdx === -1) throw new Error('CREATE TABLE 语句括号不匹配')

  const body = cleaned.slice(startIdx + 1, endIdx)
  const items = splitCreateTableBody(body)
  const columns = []
  const indexes = []

  for (const item of items) {
    const upper = item.trimStart().toUpperCase()

    if (upper.startsWith('PRIMARY KEY')) {
      indexes.push({ name: 'primary', rawName: 'PRIMARY KEY', type: 'PRIMARY', columns: extractIndexColumns(item) })
      continue
    }
    if (upper.startsWith('UNIQUE KEY') || upper.startsWith('UNIQUE INDEX') || upper.startsWith('UNIQUE (')) {
      const { name, rawName } = extractIndexName(item, /UNIQUE\s+(?:KEY|INDEX)\s+/i)
      indexes.push({ name, rawName, type: 'UNIQUE', columns: extractIndexColumns(item) })
      continue
    }
    if (upper.startsWith('KEY ') || upper.startsWith('INDEX ')) {
      const { name, rawName } = extractIndexName(item, /(?:KEY|INDEX)\s+/i)
      indexes.push({ name, rawName, type: 'INDEX', columns: extractIndexColumns(item) })
      continue
    }
    if (upper.startsWith('FULLTEXT')) {
      const { name, rawName } = extractIndexName(item, /FULLTEXT\s+(?:KEY|INDEX)?\s*/i)
      indexes.push({ name, rawName, type: 'FULLTEXT', columns: extractIndexColumns(item) })
      continue
    }
    if (upper.startsWith('CONSTRAINT ') || upper.startsWith('FOREIGN KEY')) continue

    const identMatch = item.trimStart().match(/(`[^`]+`|"[^"]+"|[\w$]+)/)
    if (!identMatch) continue
    const rawName = identMatch[0]
    const name = normaliseIdent(rawName)
    const afterName = item.trimStart().slice(identMatch.index + rawName.length).trim()
    columns.push({ name, rawName, fullDef: afterName })
  }

  return { tableName, rawTableName, columns, indexes }
}

function normaliseFullDef(def) {
  return def.replace(/\s+/g, ' ').trim().toUpperCase()
    .replace(/DEFAULT\s+'([^']*)'/g, "DEFAULT '$1'")
}

function indexDefsEqual(a, b) {
  return a.type === b.type && a.columns.length === b.columns.length
    && a.columns.every((c, i) => c === b.columns[i])
}

function diffDDL(from, to, includeIndexes = true) {
  const columnChanges = []
  const indexChanges = []

  const fromColMap = new Map(from.columns.map((c) => [c.name, c]))
  const toColMap = new Map(to.columns.map((c) => [c.name, c]))

  for (const col of to.columns) {
    if (!fromColMap.has(col.name)) columnChanges.push({ kind: 'added', column: col })
  }
  for (const col of from.columns) {
    if (!toColMap.has(col.name)) columnChanges.push({ kind: 'removed', column: col })
  }
  for (const toCol of to.columns) {
    const fromCol = fromColMap.get(toCol.name)
    if (fromCol && normaliseFullDef(fromCol.fullDef) !== normaliseFullDef(toCol.fullDef)) {
      columnChanges.push({ kind: 'modified', column: toCol, fromColumn: fromCol })
    }
  }

  if (includeIndexes) {
    const fromIdxMap = new Map(from.indexes.map((i) => [i.name, i]))
    const toIdxMap = new Map(to.indexes.map((i) => [i.name, i]))
    for (const idx of to.indexes) {
      if (!fromIdxMap.has(idx.name)) indexChanges.push({ kind: 'added', index: idx })
    }
    for (const idx of from.indexes) {
      if (!toIdxMap.has(idx.name)) indexChanges.push({ kind: 'removed', index: idx })
    }
    for (const toIdx of to.indexes) {
      const fromIdx = fromIdxMap.get(toIdx.name)
      if (fromIdx && !indexDefsEqual(fromIdx, toIdx)) {
        indexChanges.push({ kind: 'modified', index: toIdx, fromIndex: fromIdx })
      }
    }
  }

  return {
    fromTableName: from.tableName, toTableName: to.tableName,
    columnChanges, indexChanges,
    hasChanges: columnChanges.length > 0 || indexChanges.length > 0,
  }
}

function quoteIdent(name, dialect) {
  const bare = name.replace(/^[`"[\]]|[`"[\]]$/g, '')
  return (dialect === 'postgresql' || dialect === 'oracle') ? `"${bare}"` : `\`${bare}\``
}

function parseColDef(fullDef) {
  let def = fullDef.trim()
  let notNull = null
  if (/\bNOT\s+NULL\b/i.test(def)) { notNull = true; def = def.replace(/\bNOT\s+NULL\b/gi, '').trim() }
  else if (/\bNULL\b/i.test(def)) { notNull = false; def = def.replace(/\bNULL\b/gi, '').trim() }

  let defaultExpr = null
  const defaultMatch = def.match(/\bDEFAULT\s+(.+?)(?:\s+(?:ON\s+UPDATE|AUTO_INCREMENT|COMMENT|CHARACTER\s+SET|COLLATE)\b|$)/i)
  if (defaultMatch) {
    defaultExpr = defaultMatch[1].trim()
    def = def.slice(0, defaultMatch.index).trim()
  }
  def = def.replace(/\bAUTO_INCREMENT\b/gi, '').replace(/\bCOMMENT\s+'[^']*'/gi, '').trim()
  return { typePart: def.trim(), notNull, defaultExpr }
}

function generateDropIndex(table, idx, dialect) {
  if (idx.type === 'PRIMARY') {
    if (dialect === 'postgresql') return [`ALTER TABLE ${table} DROP CONSTRAINT ${table}_pkey;`]
    return [`ALTER TABLE ${table} DROP PRIMARY KEY;`]
  }
  const idxName = quoteIdent(idx.rawName, dialect)
  if (dialect === 'mysql') return [`ALTER TABLE ${table} DROP INDEX ${idxName};`]
  if (dialect === 'postgresql') return [`DROP INDEX IF EXISTS ${idxName};`]
  return [`DROP INDEX ${idxName};`]
}

function generateCreateIndex(table, idx, dialect) {
  const cols = idx.columns.map((c) => quoteIdent(c, dialect)).join(', ')
  if (idx.type === 'PRIMARY') return [`ALTER TABLE ${table} ADD PRIMARY KEY (${cols});`]
  const idxName = quoteIdent(idx.rawName, dialect)
  const unique = idx.type === 'UNIQUE' ? 'UNIQUE ' : ''
  if (dialect === 'mysql') return [`ALTER TABLE ${table} ADD ${unique}INDEX ${idxName} (${cols});`]
  return [`CREATE ${unique}INDEX ${idxName} ON ${table} (${cols});`]
}

function generateAlterSql(diff, dialect, targetTableName) {
  const table = quoteIdent(targetTableName ?? diff.fromTableName, dialect)
  const stmts = []

  for (const change of diff.columnChanges) {
    const colName = quoteIdent(change.column.rawName, dialect)
    if (change.kind === 'added') {
      stmts.push(`ALTER TABLE ${table} ADD COLUMN ${colName} ${change.column.fullDef};`)
    } else if (change.kind === 'removed') {
      stmts.push(`ALTER TABLE ${table} DROP COLUMN ${colName};`)
    } else if (change.kind === 'modified') {
      if (dialect === 'mysql') {
        stmts.push(`ALTER TABLE ${table} MODIFY COLUMN ${colName} ${change.column.fullDef};`)
      } else if (dialect === 'postgresql') {
        const { typePart, notNull, defaultExpr } = parseColDef(change.column.fullDef)
        stmts.push(`ALTER TABLE ${table} ALTER COLUMN ${colName} TYPE ${typePart};`)
        if (notNull !== null) stmts.push(`ALTER TABLE ${table} ALTER COLUMN ${colName} ${notNull ? 'SET NOT NULL' : 'DROP NOT NULL'};`)
        if (defaultExpr !== null) {
          stmts.push(defaultExpr === ''
            ? `ALTER TABLE ${table} ALTER COLUMN ${colName} DROP DEFAULT;`
            : `ALTER TABLE ${table} ALTER COLUMN ${colName} SET DEFAULT ${defaultExpr};`)
        }
      } else {
        stmts.push(`ALTER TABLE ${table} MODIFY ${colName} ${change.column.fullDef};`)
      }
    }
  }

  for (const change of diff.indexChanges) {
    if (change.kind === 'removed' || change.kind === 'modified') {
      stmts.push(...generateDropIndex(table, change.fromIndex ?? change.index, dialect))
    }
    if (change.kind === 'added' || change.kind === 'modified') {
      stmts.push(...generateCreateIndex(table, change.index, dialect))
    }
  }

  return stmts.join('\n')
}

module.exports = { parseDDL, diffDDL, generateAlterSql }
