// stream/dedupe.js — 大文件两遍扫描去重
// 第一遍：建 key→lineNo 索引（Map 在内存，仅存 key 字符串和行号）
// 第二遍：按保留行号过滤写出
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
 * 流式去重（两遍 IO）
 * 因为大文件可能含多行 INSERT，第一步先展开到临时文件再两遍扫描。
 */
async function dedupeFileStream(inputPath, outputPath, options = {}) {
  const { keyColumn, keyColIndex, keepLast = true, onProgress } = options

  const inputSize = fs.statSync(inputPath).size

  // ── 第一遍：展开多行 INSERT + 建索引 ──────────────────────────────────────
  const tmpPath = path.join(os.tmpdir(), `sqlmate_dedupe_${Date.now()}.tmp`)
  const tmpWriter = fs.createWriteStream(tmpPath, { encoding: 'utf8' })

  let bytesRead = 0, lastPct = 0
  const tmpLines = []   // 展开后的所有行（内存存字符串；若文件极大可改为行号→文件索引）

  for await (const line of makeReadline(inputPath)) {
    bytesRead += Buffer.byteLength(line, 'utf8') + 1
    const pct = Math.min(49, Math.floor((bytesRead / inputSize) * 50))
    if (onProgress && pct > lastPct) { onProgress(pct); lastPct = pct }

    const expanded = splitMultiRowInsert(line.trimEnd())
    for (const l of expanded) {
      tmpLines.push(l)
      tmpWriter.write(l + '\n')
    }
  }
  await new Promise((resolve, reject) => tmpWriter.end((err) => (err ? reject(err) : resolve())))

  // ── 建 key→index 映射 ────────────────────────────────────────────────────
  const keyToIndex = new Map()
  let originalCount = 0

  for (let i = 0; i < tmpLines.length; i++) {
    const trimmed = tmpLines[i].trimEnd()
    if (!/^INSERT\s+INTO\s+/i.test(trimmed)) continue
    const parsed = parseInsertLine(trimmed)
    if (!parsed) continue
    originalCount++

    let keyVal = null
    if (keyColumn && parsed.columns) {
      const idx = parsed.columns.findIndex((c) => c.toLowerCase() === keyColumn.toLowerCase())
      if (idx !== -1) keyVal = parsed.values[idx] ?? null
    } else if (keyColIndex !== undefined) {
      keyVal = parsed.values[keyColIndex - 1] ?? null
    }

    if (keyVal === null) { keyToIndex.set(`\0unique\0${i}`, i); continue }
    const compositeKey = `${parsed.tableName}\0${keyVal}`
    if (!keyToIndex.has(compositeKey) || keepLast) keyToIndex.set(compositeKey, i)
  }

  const keptSet = new Set(keyToIndex.values())

  // ── 第二遍：输出保留行 ────────────────────────────────────────────────────
  const writer = fs.createWriteStream(outputPath, { encoding: 'utf8' })
  let keptCount = 0

  for (let i = 0; i < tmpLines.length; i++) {
    const pct = 50 + Math.min(49, Math.floor((i / tmpLines.length) * 50))
    if (onProgress && pct > lastPct) { onProgress(pct); lastPct = pct }

    const trimmed = tmpLines[i].trimEnd()
    if (/^INSERT\s+INTO\s+/i.test(trimmed) && parseInsertLine(trimmed)) {
      if (keptSet.has(i)) { writer.write(trimmed + '\n'); keptCount++ }
    } else {
      writer.write(trimmed + '\n')
    }
  }

  await new Promise((resolve, reject) => writer.end((err) => (err ? reject(err) : resolve())))

  // 清理临时文件
  try { fs.unlinkSync(tmpPath) } catch {}

  if (onProgress) onProgress(100)
  return { originalCount, keptCount, removedCount: originalCount - keptCount }
}

module.exports = { dedupeFileStream }
