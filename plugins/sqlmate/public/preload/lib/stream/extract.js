// stream/extract.js — 大文件两遍扫描按表名抽取
'use strict'

const fs = require('node:fs')
const readline = require('node:readline')

const INSERT_RE =
  /INSERT\s+(?:LOW_PRIORITY\s+|DELAYED\s+|HIGH_PRIORITY\s+|IGNORE\s+)?INTO\s+((?:`[^`]+`|\w+)(?:\.(?:`[^`]+`|\w+))?)/i

function normalizeTableName(raw) {
  const stripped = raw.replace(/`/g, '')
  const parts = stripped.split('.')
  return (parts[parts.length - 1] ?? '').toLowerCase()
}

function makeReadline(filePath) {
  return readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })
}

/**
 * 第一遍：扫描所有表名及语句数量
 */
async function scanTablesStream(inputPath, onProgress) {
  const inputSize = fs.statSync(inputPath).size
  let bytesRead = 0, lastPct = 0
  const counts = new Map()

  for await (const line of makeReadline(inputPath)) {
    bytesRead += Buffer.byteLength(line, 'utf8') + 1
    const pct = Math.min(99, Math.floor((bytesRead / inputSize) * 100))
    if (onProgress && pct > lastPct) { onProgress(pct); lastPct = pct }

    const m = INSERT_RE.exec(line)
    if (!m) continue
    const name = normalizeTableName(m[1])
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }

  if (onProgress) onProgress(100)
  return Array.from(counts.entries()).map(([name, count]) => ({ name, count }))
}

/**
 * 第二遍：按表名过滤输出
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {string[]} tables
 * @param {{ onProgress?: (pct:number)=>void }} options
 */
async function extractTablesStream(inputPath, outputPath, tables, options = {}) {
  const { onProgress } = options
  const targetSet = new Set(tables.map((t) => t.toLowerCase().trim()))
  const inputSize = fs.statSync(inputPath).size
  let bytesRead = 0, lastPct = 0

  const writer = fs.createWriteStream(outputPath, { encoding: 'utf8' })
  let count = 0

  const tryWrite = (stmt) => {
    const m = INSERT_RE.exec(stmt)
    if (m && targetSet.has(normalizeTableName(m[1]))) {
      writer.write(stmt + '\n')
      count++
    }
  }

  // 跨行状态机：正确识别语句边界，避免字符串/注释内的分号误切
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
            tryWrite(stmtBuf.trim())
            stmtBuf = ''
            i++
          } else { stmtBuf += ch; i++ }
          break
        case 'string':
          if (ch === '\\') { stmtBuf += ch + (line[i + 1] ?? ''); i += 2 }          // 反斜杠转义
          else if (ch === "'" && line[i + 1] === "'") { stmtBuf += "''"; i += 2 }   // '' 转义
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

  for await (const line of makeReadline(inputPath)) {
    bytesRead += Buffer.byteLength(line, 'utf8') + 1
    const pct = Math.min(99, Math.floor((bytesRead / inputSize) * 100))
    if (onProgress && pct > lastPct) { onProgress(pct); lastPct = pct }

    processLine(line)
  }
  // 末尾无分号的残余语句
  if (stmtBuf.trim()) tryWrite(stmtBuf.trim())

  await new Promise((resolve, reject) => writer.end((err) => (err ? reject(err) : resolve())))
  if (onProgress) onProgress(100)
  return { count }
}

module.exports = { scanTablesStream, extractTablesStream }
