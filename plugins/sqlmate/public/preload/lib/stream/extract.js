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
  let buf = ''

  const tryWrite = (stmt) => {
    const m = INSERT_RE.exec(stmt)
    if (m && targetSet.has(normalizeTableName(m[1]))) {
      writer.write(stmt + '\n')
      count++
    }
  }

  for await (const line of makeReadline(inputPath)) {
    bytesRead += Buffer.byteLength(line, 'utf8') + 1
    const pct = Math.min(99, Math.floor((bytesRead / inputSize) * 100))
    if (onProgress && pct > lastPct) { onProgress(pct); lastPct = pct }

    buf += line.replace(/\r$/, '') + '\n'
    if (line.trimEnd().endsWith(';')) {
      tryWrite(buf.trim())
      buf = ''
    }
  }
  if (buf.trim()) tryWrite(buf.trim())

  await new Promise((resolve, reject) => writer.end((err) => (err ? reject(err) : resolve())))
  if (onProgress) onProgress(100)
  return { count }
}

module.exports = { scanTablesStream, extractTablesStream }
