// merge.js — 合并多条单行 INSERT 为批量 INSERT
'use strict'

/**
 * 从单行 INSERT 中提取 tableName / columns / 第一个 values token。
 *
 * 替代原来包含多层嵌套重复的复杂正则，避免 ReDoS。
 * 前缀（表名 + 列清单）用简单正则识别（无回溯风险），
 * VALUES 括号块用字符遍历状态机提取（线性复杂度）。
 *
 * 正确处理：
 *   - 反斜杠转义  \'  （MySQL）
 *   - 双单引号转义 ''  （标准 SQL）
 *   - 括号嵌套（depth 计数）
 *   - 未闭合输入（返回 null，不卡死）
 *
 * @param {string} line
 * @returns {{ tableName: string, columns: string, values: string } | null}
 */
function extractValuesToken(line) {
  // 前缀正则：只匹配固定结构，不涉及 VALUES 内容，无回溯风险
  const prefixRe = /^INSERT\s+INTO\s+(`?\w+`?)\s*(\([^)]*\))?\s*VALUES\s*/i
  const m = prefixRe.exec(line)
  if (!m) return null

  const tableName = m[1]
  const columns = m[2] ?? ''

  // 从 VALUES 后第一个 '(' 开始状态机扫描
  let i = m[0].length
  while (i < line.length && line[i] === ' ') i++ // 容忍少量空白
  if (i >= line.length || line[i] !== '(') return null

  const start = i
  let depth = 0
  let inStr = false

  while (i < line.length) {
    const ch = line[i]

    if (inStr) {
      if (ch === '\\') { i += 2; continue }             // 反斜杠转义（MySQL）
      if (ch === "'" && line[i + 1] === "'") { i += 2; continue } // '' 转义（标准 SQL）
      if (ch === "'") { inStr = false; i++; continue }  // 字符串结束
      i++; continue
    }

    if (ch === "'") { inStr = true; i++; continue }
    if (ch === '(') { depth++; i++; continue }
    if (ch === ')') {
      depth--
      if (depth === 0) return { tableName, columns, values: line.slice(start, i + 1) }
      if (depth < 0) return null
      i++; continue
    }
    i++
  }

  return null // 未闭合
}

function parseInserts(sql) {
  const results = []
  for (const line of sql.split('\n')) {
    const r = extractValuesToken(line.trimEnd())
    if (!r) continue
    results.push({
      tableKey: `${r.tableName}|${r.columns}`,
      tableName: r.tableName,
      columns: r.columns,
      values: r.values,
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

module.exports = { mergeSQL, extractValuesToken }
