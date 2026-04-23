// stream/split.js — 大文件流式拆分批量 INSERT 为单行
'use strict'

const fs = require('node:fs')
const readline = require('node:readline')

function extractValueGroups(valuesBlock) {
  const groups = []
  let depth = 0, start = -1, inString = false, stringChar = ''
  for (let i = 0; i < valuesBlock.length; i++) {
    const ch = valuesBlock[i]
    if (inString) {
      if (ch === '\\') { i++; continue }                                          // 反斜杠转义（MySQL）
      if (ch === stringChar && valuesBlock[i + 1] === stringChar) { i++; continue } // '' 转义（标准 SQL）
      if (ch === stringChar) { inString = false }                                 // 字符串结束
    } else if (ch === "'" || ch === '"') {
      inString = true; stringChar = ch
    } else if (ch === '(') {
      if (depth === 0) start = i; depth++
    } else if (ch === ')') {
      depth--
      if (depth === 0 && start !== -1) { groups.push(valuesBlock.slice(start, i + 1)) }
    }
  }
  return groups
}

const INSERT_PREFIX_RE = /^INSERT\s+INTO\s+(`?\w+`?)\s*(\([^)]*\))?\s*VALUES\s*/i

/**
 * 流式拆分大文件
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {{ onProgress?: (pct: number) => void }} options
 * @returns {Promise<{ statementCount: number }>}
 */
async function splitFileStream(inputPath, outputPath, options = {}) {
  const { onProgress } = options
  const inputSize = fs.statSync(inputPath).size
  let bytesRead = 0, lastPct = 0

  const rl = readline.createInterface({
    input: fs.createReadStream(inputPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })
  const writer = fs.createWriteStream(outputPath, { encoding: 'utf8' })
  let statementCount = 0

  const processStmt = (stmt) => {
    const m = INSERT_PREFIX_RE.exec(stmt)
    if (!m) { writer.write(stmt + '\n'); return }
    const tableName = m[1]
    const columns = m[2] ?? ''
    const colPart = columns ? ` ${columns}` : ''
    const valuesBlock = stmt.slice(m.index + m[0].length)
    const groups = extractValueGroups(valuesBlock)
    for (const group of groups) {
      writer.write(`INSERT INTO ${tableName}${colPart} VALUES ${group};\n`)
      statementCount++
    }
  }

  // 跨行状态机：正确识别语句边界，不被字符串/注释内的分号误触发
  // 状态：'normal' | 'string' | 'line_comment' | 'block_comment'
  let state = 'normal'
  let stmtBuf = ''

  const processLine = (line) => {
    let i = 0
    while (i < line.length) {
      const ch = line[i]
      switch (state) {
        case 'normal':
          if (ch === "'") { state = 'string'; stmtBuf += ch; i++ }
          else if (ch === '-' && line[i + 1] === '-') { state = 'line_comment'; stmtBuf += '--'; i += 2 }
          else if (ch === '/' && line[i + 1] === '*') { state = 'block_comment'; stmtBuf += '/*'; i += 2 }
          else if (ch === ';') {
            stmtBuf += ch
            processStmt(stmtBuf.trim())
            stmtBuf = ''
            i++
          } else { stmtBuf += ch; i++ }
          break
        case 'string':
          if (ch === '\\') { stmtBuf += ch + (line[i + 1] ?? ''); i += 2 }         // 反斜杠转义（MySQL）
          else if (ch === "'" && line[i + 1] === "'") { stmtBuf += "''"; i += 2 }  // '' 转义（标准 SQL）
          else if (ch === "'") { state = 'normal'; stmtBuf += ch; i++ }
          else { stmtBuf += ch; i++ }
          break
        case 'line_comment':
          stmtBuf += ch; i++
          break
        case 'block_comment':
          if (ch === '*' && line[i + 1] === '/') { state = 'normal'; stmtBuf += '*/'; i += 2 }
          else { stmtBuf += ch; i++ }
          break
      }
    }
    // 行注释在行尾自动结束
    if (state === 'line_comment') state = 'normal'
    stmtBuf += '\n'
  }

  for await (const line of rl) {
    bytesRead += Buffer.byteLength(line, 'utf8') + 1
    const pct = Math.min(99, Math.floor((bytesRead / inputSize) * 100))
    if (onProgress && pct > lastPct) { onProgress(pct); lastPct = pct }

    processLine(line.replace(/\r$/, ''))
  }
  // 末尾无分号的残余语句
  if (stmtBuf.trim()) processStmt(stmtBuf.trim())

  await new Promise((resolve, reject) => writer.end((err) => (err ? reject(err) : resolve())))
  if (onProgress) onProgress(100)

  return { statementCount }
}

module.exports = { splitFileStream }
