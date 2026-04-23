// segment.js — 按行数或大小分割 SQL 文本
'use strict'

function fileName(index) {
  return `output_${String(index).padStart(3, '0')}.sql`
}

/**
 * 状态机：将 SQL 文本拆分为独立语句数组。
 *
 * 正确处理：
 *   - 单引号字符串内的分号  INSERT INTO t VALUES ('hello;world')
 *   - '' 转义              INSERT INTO t VALUES ('it''s fine;')
 *   - 行注释               -- this; is a comment
 *   - 块注释               /* this; is a comment *\/
 *
 * @param {string} sql
 * @returns {string[]}  每条语句末尾保留分号
 */
function splitStatements(sql) {
  const statements = []
  let start = 0
  let i = 0
  // 状态：'normal' | 'string' | 'line_comment' | 'block_comment'
  let state = 'normal'

  while (i < sql.length) {
    const ch = sql[i]

    switch (state) {
      case 'normal':
        if (ch === "'") {
          state = 'string'
          i++
        } else if (ch === '-' && sql[i + 1] === '-') {
          state = 'line_comment'
          i += 2
        } else if (ch === '/' && sql[i + 1] === '*') {
          state = 'block_comment'
          i += 2
        } else if (ch === ';') {
          // 真正的语句结束符
          const stmt = sql.slice(start, i + 1).trim()
          if (stmt.length > 1) statements.push(stmt) // 去掉纯 ";" 空语句
          i++
          // 跳过分号后的空白/换行，start 指向下一条语句首字符
          while (i < sql.length && /\s/.test(sql[i])) i++
          start = i
        } else {
          i++
        }
        break

      case 'string':
        if (ch === "'" && sql[i + 1] === "'") {
          // '' 转义，不是字符串结束
          i += 2
        } else if (ch === "'") {
          state = 'normal'
          i++
        } else {
          i++
        }
        break

      case 'line_comment':
        if (ch === '\n') {
          state = 'normal'
        }
        i++
        break

      case 'block_comment':
        if (ch === '*' && sql[i + 1] === '/') {
          state = 'normal'
          i += 2
        } else {
          i++
        }
        break
    }
  }

  // 处理末尾没有分号的语句（不完整但仍输出）
  const tail = sql.slice(start).trim()
  if (tail.length > 0) statements.push(tail)

  return statements
}

function segmentSQL(sql, options) {
  const { mode, count = 10000, sizeMB = 10 } = options || {}
  const statements = splitStatements(sql)
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

module.exports = { segmentSQL, splitStatements }
