// stream/dedupe.js — 大文件两遍扫描去重
// 第一遍：展开多行 INSERT → 临时文件，同时建 key→lineNo 索引（仅存 key + 行号，内存恒定）
// 第二遍：流式读临时文件，按行号过滤写出
// 全程无 tmpLines 内存数组，支持 GB 级文件
'use strict'

const fs = require('node:fs')
const readline = require('node:readline')
const os = require('node:os')
const path = require('node:path')

const { splitMultiRowInsert, parseInsertLine } = require('../dedupe')

function makeReadline(filePath) {
  return readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })
}

/**
 * 流式去重（两遍 IO，内存恒定）
 * 第一遍：展开多行 INSERT 写临时文件 + 建 key→lineNo 索引
 * 第二遍：流式读临时文件，按 keptSet 过滤写出
 */
async function dedupeFileStream(inputPath, outputPath, options = {}) {
  const { keyColumn, keyColIndex, keepLast = true, onProgress } = options

  const inputSize = fs.statSync(inputPath).size

  // ── 第一遍：展开多行 INSERT，写临时文件，同时建 key→lineNo 索引 ──────────
  const tmpPath = path.join(os.tmpdir(), `sqlmate_dedupe_${Date.now()}.tmp`)
  const tmpWriter = fs.createWriteStream(tmpPath, { encoding: 'utf8' })

  const keyToIndex = new Map() // key string → line number（仅存两个标量，内存恒定）
  let bytesRead = 0, lastPct = 0
  let lineNo = 0        // 临时文件中的行号（0-indexed）
  let originalCount = 0

  for await (const line of makeReadline(inputPath)) {
    bytesRead += Buffer.byteLength(line, 'utf8') + 1
    const pct = Math.min(49, Math.floor((bytesRead / inputSize) * 50))
    if (onProgress && pct > lastPct) { onProgress(pct); lastPct = pct }

    const expanded = splitMultiRowInsert(line.trimEnd())
    for (const l of expanded) {
      tmpWriter.write(l + '\n')

      const trimmed = l.trimEnd()
      if (/^INSERT\s+INTO\s+/i.test(trimmed)) {
        const parsed = parseInsertLine(trimmed)
        if (parsed) {
          originalCount++

          let keyVal = null
          if (keyColumn && parsed.columns) {
            const idx = parsed.columns.findIndex((c) => c.toLowerCase() === keyColumn.toLowerCase())
            if (idx !== -1) keyVal = parsed.values[idx] ?? null
          } else if (keyColIndex !== undefined) {
            keyVal = parsed.values[keyColIndex - 1] ?? null
          }

          if (keyVal === null) {
            keyToIndex.set(`\0unique\0${lineNo}`, lineNo)
          } else {
            const compositeKey = `${parsed.tableName}\0${keyVal}`
            if (!keyToIndex.has(compositeKey) || keepLast) keyToIndex.set(compositeKey, lineNo)
          }
        }
      }

      lineNo++
    }
  }
  await new Promise((resolve, reject) => tmpWriter.end((err) => (err ? reject(err) : resolve())))

  const keptSet = new Set(keyToIndex.values()) // 仅存行号（number），内存极小
  const tmpLineCount = lineNo

  // ── 第二遍：流式读临时文件，按 keptSet 过滤写出 ───────────────────────────
  const writer = fs.createWriteStream(outputPath, { encoding: 'utf8' })
  let currentLine = 0
  let keptCount = 0

  for await (const line of makeReadline(tmpPath)) {
    const pct = 50 + Math.min(49, Math.floor((currentLine / (tmpLineCount || 1)) * 50))
    if (onProgress && pct > lastPct) { onProgress(pct); lastPct = pct }

    const trimmed = line.trimEnd()
    if (/^INSERT\s+INTO\s+/i.test(trimmed) && parseInsertLine(trimmed)) {
      if (keptSet.has(currentLine)) { writer.write(trimmed + '\n'); keptCount++ }
    } else {
      writer.write(trimmed + '\n')
    }

    currentLine++
  }

  await new Promise((resolve, reject) => writer.end((err) => (err ? reject(err) : resolve())))

  // 清理临时文件
  try { fs.unlinkSync(tmpPath) } catch {}

  if (onProgress) onProgress(100)
  return { originalCount, keptCount, removedCount: originalCount - keptCount }
}

module.exports = { dedupeFileStream }
