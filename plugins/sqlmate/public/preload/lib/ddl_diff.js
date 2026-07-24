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
  let depth = 0, inStr = false
  let current = ''
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (inStr) {
      current += ch
      if (ch === '\\') { current += body[i + 1] ?? ''; i++; continue }   // 反斜杠转义
      if (ch === "'" && body[i + 1] === "'") { current += "'"; i++; continue } // '' 转义
      if (ch === "'") inStr = false
      continue
    }
    if (ch === "'") { inStr = true; current += ch; continue }
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

/**
 * 标准化列定义用于对比：空白折叠 + 非字符串部分大写。
 * 字符串字面量内容保持原样（不做 toUpperCase）。
 */
function normaliseFullDef(def) {
  const normalised = def.replace(/\s+/g, ' ').trim()
  // 逐段处理：字符串外的部分大写，字符串内原样保留
  let result = '', inStr = false
  for (let i = 0; i < normalised.length; i++) {
    const ch = normalised[i]
    if (inStr) {
      if (ch === '\\') { result += ch + (normalised[i + 1] ?? ''); i++; continue }
      if (ch === "'" && normalised[i + 1] === "'") { result += "''"; i++; continue }
      if (ch === "'") { inStr = false; result += ch; continue }
      result += ch
    } else {
      if (ch === "'") { inStr = true; result += ch; continue }
      result += ch.toUpperCase()
    }
  }
  return result
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
  const defaultStart = def.search(/\bDEFAULT\s+/i)
  if (defaultStart !== -1) {
    // 找到 DEFAULT 关键字后，用字符扫描提取值（正确跳过字符串字面量）
    const afterKw = def.slice(defaultStart).replace(/^DEFAULT\s+/i, '')
    let i = 0, inStr = false
    while (i < afterKw.length) {
      const ch = afterKw[i]
      if (inStr) {
        if (ch === '\\') { i += 2; continue }                          // 反斜杠转义
        if (ch === "'" && afterKw[i + 1] === "'") { i += 2; continue } // '' 转义
        if (ch === "'") { inStr = false; i++; continue }
      } else {
        if (ch === "'") { inStr = true; i++; continue }
        // 在字符串外遇到后续关键字时停止
        if (/^(?:ON\s+UPDATE|AUTO_INCREMENT|COMMENT|CHARACTER\s+SET|COLLATE)\b/i.test(afterKw.slice(i))) break
      }
      i++
    }
    defaultExpr = afterKw.slice(0, i).trim()
    def = def.slice(0, defaultStart).trim()
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
