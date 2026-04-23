// stream/segment.js — 大文件流式分割为多个文件
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')

function fileName(index) {
  return `output_${String(index).padStart(3, '0')}.sql`
}

/**
 * 流式分割大文件
 * @param {string} inputPath
 * @param {string} outputDir   输出目录
 * @param {{ mode: 'count'|'size', count?: number, sizeMB?: number, onProgress?: (pct:number)=>void }} options
 * @returns {Promise<{ fileCount: number, fileNames: string[] }>}
 */
async function segmentFileStream(inputPath, outputDir, options = {}) {
  const { mode, count = 10000, sizeMB = 10, onProgress } = options
  const maxBytes = sizeMB * 1024 * 1024
  const inputSize = fs.statSync(inputPath).size
  let bytesRead = 0, lastPct = 0

  fs.mkdirSync(outputDir, { recursive: true })

  const rl = readline.createInterface({
    input: fs.createReadStream(inputPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })

  let fileIndex = 1
  let currentWriter = null
  let currentCount = 0
  let currentBytes = 0
  const fileNames = []
  let buf = ''

  function openNextFile() {
    if (currentWriter) currentWriter.end()
    const name = fileName(fileIndex++)
    fileNames.push(name)
    currentWriter = fs.createWriteStream(path.join(outputDir, name), { encoding: 'utf8' })
    currentCount = 0
    currentBytes = 0
  }

  function writeStmt(stmt) {
    const stmtBytes = Buffer.byteLength(stmt, 'utf8') + 1
    const needNewFile = mode === 'count'
      ? currentCount >= count
      : currentBytes + stmtBytes > maxBytes && currentCount > 0

    if (!currentWriter || needNewFile) openNextFile()

    currentWriter.write(stmt + '\n')
    currentCount++
    currentBytes += stmtBytes
  }

  for await (const line of rl) {
    bytesRead += Buffer.byteLength(line, 'utf8') + 1
    const pct = Math.min(99, Math.floor((bytesRead / inputSize) * 100))
    if (onProgress && pct > lastPct) { onProgress(pct); lastPct = pct }

    buf += line.replace(/\r$/, '') + '\n'
    if (line.trimEnd().endsWith(';')) {
      writeStmt(buf.trim())
      buf = ''
    }
  }
  if (buf.trim()) writeStmt(buf.trim())

  if (currentWriter) {
    await new Promise((resolve, reject) => currentWriter.end((err) => (err ? reject(err) : resolve())))
  }

  if (onProgress) onProgress(100)
  return { fileCount: fileNames.length, fileNames }
}

module.exports = { segmentFileStream }
