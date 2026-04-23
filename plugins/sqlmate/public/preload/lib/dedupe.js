// dedupe.js — INSERT 去重
'use strict'

function parseSqlValues(valStr) {
  const tokens = []
  let i = 0
  while (i < valStr.length) {
    while (i < valStr.length && /\s/.test(valStr[i])) i++
    if (i >= valStr.length) break

    if (valStr[i] === "'") {
      let j = i + 1
      while (j < valStr.length) {
        if (valStr[j] === '\\') { j += 2; continue }                      // 反斜杠转义（MySQL）
        if (valStr[j] === "'" && valStr[j + 1] === "'") { j += 2; continue } // '' 转义（标准 SQL）
        if (valStr[j] === "'") { j++; break }                             // 字符串结束
        j++
      }
      tokens.push(valStr.slice(i, j))
      i = j
    } else {
      let j = i
      while (j < valStr.length && valStr[j] !== ',' && !/\s/.test(valStr[j])) j++
      tokens.push(valStr.slice(i, j))
      i = j
    }

    while (i < valStr.length && /\s/.test(valStr[i])) i++
    if (i < valStr.length && valStr[i] === ',') i++
  }
  return tokens
}

function splitMultiRowInsert(line) {
  const trimmed = line.trimEnd()
  const m = /\bVALUES\b/i.exec(trimmed)
  if (!m) return [trimmed]

  const prefixEnd = m.index + m[0].length
  const prefix = trimmed.slice(0, prefixEnd)
  const rest = trimmed.slice(prefixEnd).trimStart()

  const tuples = []
  let depth = 0
  let inStr = false
  let start = -1

  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]
    if (inStr) {
      if (ch === '\\') { i++; continue }                        // 反斜杠转义（MySQL）
      if (ch === "'" && rest[i + 1] === "'") { i++; continue }  // '' 转义（标准 SQL）
      if (ch === "'") inStr = false
      continue
    }
    if (ch === "'") { inStr = true; continue }
    if (ch === '(') { if (depth === 0) start = i; depth++ }
    else if (ch === ')') {
      depth--
      if (depth === 0 && start !== -1) {
        tuples.push(rest.slice(start, i + 1))
        start = -1
      }
    }
  }

  if (tuples.length <= 1) return [trimmed]
  return tuples.map((t) => `${prefix} ${t};`)
}

/**
 * 流式拆分多行 INSERT：每找到一个 tuple 立即调用 cb，不积攒数组。
 * 用于大文件流式处理路径，保持 O(1) 内存。
 *
 * @param {string} line
 * @param {(singleInsert: string) => void} cb
 */
function forEachTupleInInsert(line, cb) {
  const trimmed = line.trimEnd()
  const m = /\bVALUES\b/i.exec(trimmed)
  if (!m) { cb(trimmed); return }

  const prefixEnd = m.index + m[0].length
  const prefix = trimmed.slice(0, prefixEnd)
  const rest = trimmed.slice(prefixEnd).trimStart()

  let depth = 0
  let inStr = false
  let start = -1
  let tupleCount = 0

  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]
    if (inStr) {
      if (ch === '\\') { i++; continue }
      if (ch === "'" && rest[i + 1] === "'") { i++; continue }
      if (ch === "'") inStr = false
      continue
    }
    if (ch === "'") { inStr = true; continue }
    if (ch === '(') { if (depth === 0) start = i; depth++ }
    else if (ch === ')') {
      depth--
      if (depth === 0 && start !== -1) {
        tupleCount++
        cb(`${prefix} ${rest.slice(start, i + 1)};`)
        start = -1
      }
    }
  }

  // 如果没有找到任何 tuple（不是标准多行 INSERT），原样回调
  if (tupleCount === 0) cb(trimmed)
}

function parseInsertLine(line) {
  const re =
    /^INSERT\s+INTO\s+`?([^`\s(]+)`?\s*(?:\(([^)]*)\)\s*)?VALUES\s*\(([^)]*(?:\)[^;]*\()*[^)]*)\)/i
  const m = line.match(re)
  if (!m) return null

  const tableName = m[1]
  let columns = null
  if (m[2] !== undefined && m[2].trim() !== '') {
    columns = m[2].split(',').map((c) => c.trim().replace(/^`|`$/g, ''))
  }

  const valuesStart = line.search(/VALUES\s*\(/i)
  if (valuesStart === -1) return null
  const parenOpen = line.indexOf('(', valuesStart)
  const parenClose = line.lastIndexOf(')')
  if (parenOpen === -1 || parenClose === -1 || parenClose <= parenOpen) return null

  const valStr = line.slice(parenOpen + 1, parenClose)
  const values = parseSqlValues(valStr)

  return { tableName, columns, values }
}

function extractKey(parsed, keyColumn, keyColIndex) {
  if (keyColumn !== undefined) {
    if (parsed.columns === null) return null
    const idx = parsed.columns.findIndex(
      (c) => c.toLowerCase() === keyColumn.toLowerCase()
    )
    if (idx === -1) return null
    return parsed.values[idx] ?? null
  }
  if (keyColIndex !== undefined) {
    return parsed.values[keyColIndex - 1] ?? null
  }
  return null
}

function dedupeSql(sql, options) {
  const { keyColumn, keyColIndex, keepLast = true } = options || {}
  const lines = sql.split('\n').flatMap(splitMultiRowInsert)
  const keyToIndex = new Map()
  let originalCount = 0

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimEnd()
    if (!/^INSERT\s+INTO\s+/i.test(trimmed)) continue
    const parsed = parseInsertLine(trimmed)
    if (!parsed) continue
    originalCount++
    const keyVal = extractKey(parsed, keyColumn, keyColIndex)
    if (keyVal === null) {
      keyToIndex.set(`\0unique\0${i}`, i)
      continue
    }
    const compositeKey = `${parsed.tableName}\0${keyVal}`
    if (!keyToIndex.has(compositeKey) || keepLast) {
      keyToIndex.set(compositeKey, i)
    }
  }

  const keptLineIndices = new Set(keyToIndex.values())
  const outputLines = []
  let keptCount = 0

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimEnd()
    if (/^INSERT\s+INTO\s+/i.test(trimmed) && parseInsertLine(trimmed) !== null) {
      if (keptLineIndices.has(i)) {
        outputLines.push(trimmed)
        keptCount++
      }
    } else {
      outputLines.push(trimmed)
    }
  }

  while (outputLines.length > 0 && outputLines[outputLines.length - 1].trim() === '') {
    outputLines.pop()
  }

  return {
    sql: outputLines.join('\n'),
    originalCount,
    keptCount,
    removedCount: originalCount - keptCount,
  }
}

/**
 * 将表名各部分用反引号安全包裹，正确处理 schema 限定名（如 mydb.mytable）。
 * 输入如 'mydb.mytable' → '`mydb`.`mytable`'
 * 输入如 '`table`'     → '`table`'
 * @param {string} raw  parseInsertLine 返回的 tableName
 * @returns {string}
 */
function quoteTableName(raw) {
  return raw
    .split('.')
    .map((part) => '`' + part.replace(/`/g, '') + '`')
    .join('.')
}

module.exports = { parseSqlValues, splitMultiRowInsert, forEachTupleInInsert, parseInsertLine, dedupeSql, quoteTableName }
