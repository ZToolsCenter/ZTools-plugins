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

  // 跨行累积当前语句
  let stmtBuf = ''
  // 状态机状态（跨行持久化）
  // 状态：'normal' | 'string' | 'line_comment' | 'block_comment'
  let state = 'normal'

  function openNextFile() {
    if (currentWriter) currentWriter.end()
    const name = fileName(fileIndex++)
    fileNames.push(name)
    currentWriter = fs.createWriteStream(path.join(outputDir, name), { encoding: 'utf8' })
    currentCount = 0
    currentBytes = 0
  }

  function flushStmt(stmt) {
    const trimmed = stmt.trim()
    if (!trimmed) return
    const stmtBytes = Buffer.byteLength(trimmed, 'utf8') + 1
    const needNewFile = mode === 'count'
      ? currentCount >= count
      : currentBytes + stmtBytes > maxBytes && currentCount > 0

    if (!currentWriter || needNewFile) openNextFile()

    currentWriter.write(trimmed + '\n')
    currentCount++
    currentBytes += stmtBytes
  }

  /**
   * 用状态机扫描一行文本，正确识别语句边界。
   * 状态跨行持久化（单引号字符串、块注释均可跨行）。
   * 行注释在行尾自动归零（readline 已去除换行符）。
   *
   * @param {string} line  readline 给出的单行（不含换行符）
   */
  function processLine(line) {
    let i = 0

    while (i < line.length) {
      const ch = line[i]

      switch (state) {
        case 'normal':
          if (ch === "'") {
            state = 'string'
            stmtBuf += ch
            i++
          } else if (ch === '-' && line[i + 1] === '-') {
            state = 'line_comment'
            stmtBuf += ch + (line[i + 1] ?? '')
            i += 2
          } else if (ch === '/' && line[i + 1] === '*') {
            state = 'block_comment'
            stmtBuf += ch + (line[i + 1] ?? '')
            i += 2
          } else if (ch === ';') {
            stmtBuf += ch
            flushStmt(stmtBuf)
            stmtBuf = ''
            i++
          } else {
            stmtBuf += ch
            i++
          }
          break

        case 'string':
          if (ch === "'" && line[i + 1] === "'") {
            // '' 转义
            stmtBuf += "''"
            i += 2
          } else if (ch === "'") {
            state = 'normal'
            stmtBuf += ch
            i++
          } else {
            stmtBuf += ch
            i++
          }
          break

        case 'line_comment':
          // 行注释内容不影响语句，直接追加到 buf 保持原文
          stmtBuf += ch
          i++
          break

        case 'block_comment':
          if (ch === '*' && line[i + 1] === '/') {
            state = 'normal'
            stmtBuf += '*/'
            i += 2
          } else {
            stmtBuf += ch
            i++
          }
          break
      }
    }

    // 行注释在行尾结束（readline 已去掉换行符）
    if (state === 'line_comment') state = 'normal'

    // 保留换行符以维持多行语句的可读性
    stmtBuf += '\n'
  }

  for await (const line of rl) {
    bytesRead += Buffer.byteLength(line, 'utf8') + 1
    const pct = Math.min(99, Math.floor((bytesRead / inputSize) * 100))
    if (onProgress && pct > lastPct) { onProgress(pct); lastPct = pct }

    processLine(line)
  }

  // 末尾无分号的残余语句
  if (stmtBuf.trim()) flushStmt(stmtBuf)

  if (currentWriter) {
    await new Promise((resolve, reject) => currentWriter.end((err) => (err ? reject(err) : resolve())))
  }

  if (onProgress) onProgress(100)
  return { fileCount: fileNames.length, fileNames }
}

module.exports = { segmentFileStream }
