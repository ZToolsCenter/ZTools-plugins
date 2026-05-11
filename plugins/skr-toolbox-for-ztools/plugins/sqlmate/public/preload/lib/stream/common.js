// stream/common.js — 通用流式逐行处理工厂
// 用于 mask / rename / offset / convert_stmt 等逐行处理功能
'use strict'

const fs = require('node:fs')
const readline = require('node:readline')
const { forEachTupleInInsert } = require('../dedupe')

/**
 * 通用流式处理：逐行读取 →（expandMultiRow 时）缓冲完整 INSERT 语句 → 展开多值 → processLine → 写出
 *
 * expandMultiRow=true（默认）：
 *   - 非 INSERT 行直接原样写出
 *   - INSERT 行用状态机跨行缓冲，等完整语句后再展开每个 tuple 调用 processLine
 *   - 正确处理字符串内分号（不会误切）
 *
 * expandMultiRow=false（rename 用）：
 *   - 每行直接调用 processLine，不做缓冲和展开
 *
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {(line: string, ctx: object) => string} processLine  返回处理后的行
 * @param {object} ctx                                          处理函数共享上下文（统计等）
 * @param {{ onProgress?: (pct: number) => void, expandMultiRow?: boolean }} options
 */
async function processFileStream(inputPath, outputPath, processLine, ctx, options = {}) {
  const { onProgress, expandMultiRow = true } = options
  const inputSize = fs.statSync(inputPath).size
  let bytesRead = 0, lastPct = 0

  const rl = readline.createInterface({
    input: fs.createReadStream(inputPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })
  const writer = fs.createWriteStream(outputPath, { encoding: 'utf8' })

  // 展开完整 INSERT 语句：每个 tuple 调用 processLine 后写出
  function writeExpandedInsert(stmt) {
    forEachTupleInInsert(stmt.trimEnd(), (singleInsert) => {
      // 把多行 INSERT 展开后的单条语句内部换行替换为空格，确保 processLine 收到单行字符串
      // 只替换换行符为空格，不做 \s+ 折叠（避免破坏字符串字面量内的多空格）
      const oneLiner = singleInsert.replace(/\r?\n/g, ' ').trim()
      writer.write(processLine(oneLiner, ctx) + '\n')
    })
  }

  // ── expandMultiRow=true 路径的跨行缓冲状态 ───────────────────────────────
  // 状态机：'normal' | 'string' | 'line_comment' | 'block_comment'
  let state = 'normal'
  let stmtBuf = ''         // 当前正在缓冲的 INSERT 语句
  let bufferingInsert = false
  let pendingStar = false  // 块注释中 * 在行尾，等下一行的 /

  /**
   * 把一行追加到 stmtBuf，逐字符扫描检测语句是否结束（遇到 normal 状态下的 ; ）。
   * 跨行注释/字符串状态由 state 持久保存。
   * @returns {boolean} 是否检测到语句结束
   */
  function appendAndDetectEnd(line) {
    let i = 0

    // 处理跨行的 */ ：上一行末尾是 *，本行开头是 /
    if (pendingStar && state === 'block_comment') {
      pendingStar = false
      if (line.length > 0 && line[0] === '/') {
        state = 'normal'; stmtBuf += '/'; i = 1
      }
    }

    while (i < line.length) {
      const ch = line[i]
      switch (state) {
        case 'normal':
          if (ch === "'") {
            state = 'string'; stmtBuf += ch; i++
          } else if (ch === '-' && line[i + 1] === '-') {
            state = 'line_comment'; stmtBuf += '--'; i += 2
          } else if (ch === '/' && line[i + 1] === '*') {
            state = 'block_comment'; stmtBuf += '/*'; i += 2
          } else if (ch === ';') {
            stmtBuf += ch; i++
            stmtBuf += line.slice(i) + '\n'
            if (state === 'line_comment') state = 'normal'
            return true
          } else {
            stmtBuf += ch; i++
          }
          break
        case 'string':
          if (ch === '\\') {
            stmtBuf += ch + (line[i + 1] ?? ''); i += 2
          } else if (ch === "'" && line[i + 1] === "'") {
            stmtBuf += "''"; i += 2
          } else if (ch === "'") {
            state = 'normal'; stmtBuf += ch; i++
          } else {
            stmtBuf += ch; i++
          }
          break
        case 'line_comment':
          stmtBuf += ch; i++
          break
        case 'block_comment':
          if (ch === '*' && line[i + 1] === '/') {
            state = 'normal'; stmtBuf += '*/'; i += 2
          } else if (ch === '*' && i === line.length - 1) {
            // * 在行尾，标记等待下一行的 /
            stmtBuf += ch; i++; pendingStar = true
          } else {
            stmtBuf += ch; i++
          }
          break
      }
    }
    // 行注释在行尾自动结束
    if (state === 'line_comment') state = 'normal'
    stmtBuf += '\n'
    return false
  }

  // ── 主循环 ────────────────────────────────────────────────────────────────
  for await (const rawLine of rl) {
    bytesRead += Buffer.byteLength(rawLine, 'utf8') + 1
    const pct = Math.min(99, Math.floor((bytesRead / inputSize) * 100))
    if (onProgress && pct > lastPct) { onProgress(pct); lastPct = pct }

    const line = rawLine.trimEnd()

    if (!expandMultiRow) {
      // rename 等不需要展开，直接逐行处理
      writer.write(processLine(line, ctx) + '\n')
      continue
    }

    if (!bufferingInsert) {
      // 不在缓冲状态：判断当前行是否是 INSERT 的起始
      if (!/^\s*INSERT\s+INTO\b/i.test(line)) {
        // 非 INSERT 行（注释、DDL、SET 等）原样写出
        writer.write(processLine(line, ctx) + '\n')
        continue
      }
      // 开始缓冲一条 INSERT 语句
      bufferingInsert = true
      stmtBuf = ''
      state = 'normal'
    }

    const ended = appendAndDetectEnd(line)

    if (ended) {
      writeExpandedInsert(stmtBuf)
      stmtBuf = ''
      state = 'normal'
      bufferingInsert = false
    }
    // 未结束：继续下一行追加
  }

  // 文件末尾残留（缺少结尾分号的 INSERT）
  if (bufferingInsert && stmtBuf.trim()) {
    writeExpandedInsert(stmtBuf)
  }

  await new Promise((resolve, reject) => writer.end((err) => (err ? reject(err) : resolve())))
  if (onProgress) onProgress(100)
}

module.exports = { processFileStream }
