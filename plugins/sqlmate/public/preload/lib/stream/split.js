// stream/split.js — 大文件流式拆分批量 INSERT 为单行
'use strict'

const fs = require('node:fs')
const readline = require('node:readline')

function extractValueGroups(valuesBlock) {
  const groups = []
  let depth = 0, start = -1, inString = false, stringChar = ''
  for (let i = 0; i < valuesBlock.length; i++) {
    const ch = valuesBlock[i]
    if (!inString && (ch === "'" || ch === '"')) { inString = true; stringChar = ch }
    else if (inString && ch === stringChar && valuesBlock[i - 1] !== '\\') { inString = false }
    else if (!inString) {
      if (ch === '(') { if (depth === 0) start = i; depth++ }
      else if (ch === ')') {
        depth--
        if (depth === 0 && start !== -1) { groups.push(valuesBlock.slice(start, i + 1)) }
      }
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

  // 每次 readline 给一行，但 INSERT 语句可能跨多行（大文件 dump 少见，但需处理）
  // 策略：按行拼接，遇到以 ; 结尾的行视为语句完成
  let buf = ''

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

  for await (const line of rl) {
    bytesRead += Buffer.byteLength(line, 'utf8') + 1
    const pct = Math.min(99, Math.floor((bytesRead / inputSize) * 100))
    if (onProgress && pct > lastPct) { onProgress(pct); lastPct = pct }

    buf += line.replace(/\r$/, '') + '\n'
    if (line.trimEnd().endsWith(';')) {
      processStmt(buf.trim())
      buf = ''
    }
  }
  if (buf.trim()) processStmt(buf.trim())

  await new Promise((resolve, reject) => writer.end((err) => (err ? reject(err) : resolve())))
  if (onProgress) onProgress(100)

  return { statementCount }
}

module.exports = { splitFileStream }
