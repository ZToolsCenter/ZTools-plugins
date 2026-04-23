// diff.js — 数据行级 Diff（按主键对比两份 SQL）
'use strict'

const { parseInsertLine, splitMultiRowInsert } = require('./dedupe')

function extractRows(sql, keyColumn, keyColIndex) {
  const map = new Map()
  for (const line of sql.split('\n').flatMap(splitMultiRowInsert)) {
    const trimmed = line.trimEnd()
    if (!/^INSERT\s+INTO\s+/i.test(trimmed)) continue
    const parsed = parseInsertLine(trimmed)
    if (!parsed) continue
    const { tableName, columns, values } = parsed
    let keyValue = null
    if (keyColumn && columns) {
      const idx = columns.findIndex((c) => c.toLowerCase() === keyColumn.toLowerCase())
      if (idx !== -1) keyValue = values[idx] ?? null
    } else if (keyColIndex !== undefined) {
      keyValue = values[keyColIndex - 1] ?? null
    }
    if (keyValue === null) continue
    const compositeKey = `${tableName}\0${keyValue}`
    map.set(compositeKey, { tableName, keyValue, columns, values })
  }
  return map
}

function diffSql(leftSql, rightSql, keyColumn, keyColIndex) {
  const leftMap = extractRows(leftSql, keyColumn, keyColIndex)
  const rightMap = extractRows(rightSql, keyColumn, keyColIndex)

  const rows = []
  let addedCount = 0, removedCount = 0, modifiedCount = 0, unchangedCount = 0
  const allKeys = new Set([...leftMap.keys(), ...rightMap.keys()])

  for (const key of allKeys) {
    const left = leftMap.get(key)
    const right = rightMap.get(key)

    if (left && !right) {
      removedCount++
      rows.push({ status: 'removed', tableName: left.tableName, keyValue: left.keyValue,
        leftValues: left.values, rightValues: null, columns: left.columns, changedColumns: [] })
    } else if (!left && right) {
      addedCount++
      rows.push({ status: 'added', tableName: right.tableName, keyValue: right.keyValue,
        leftValues: null, rightValues: right.values, columns: right.columns, changedColumns: [] })
    } else if (left && right) {
      const changedColumns = []
      const maxLen = Math.max(left.values.length, right.values.length)
      for (let i = 0; i < maxLen; i++) {
        if (left.values[i] !== right.values[i]) {
          changedColumns.push(left.columns?.[i] ?? right.columns?.[i] ?? `col${i + 1}`)
        }
      }
      if (changedColumns.length > 0) {
        modifiedCount++
        rows.push({ status: 'modified', tableName: left.tableName, keyValue: left.keyValue,
          leftValues: left.values, rightValues: right.values,
          columns: left.columns ?? right.columns, changedColumns })
      } else {
        unchangedCount++
        rows.push({ status: 'unchanged', tableName: left.tableName, keyValue: left.keyValue,
          leftValues: left.values, rightValues: right.values, columns: left.columns, changedColumns: [] })
      }
    }
  }

  const order = { removed: 0, modified: 1, added: 2, unchanged: 3 }
  rows.sort((a, b) => order[a.status] - order[b.status])

  return { rows, addedCount, removedCount, modifiedCount, unchangedCount }
}

module.exports = { diffSql }
