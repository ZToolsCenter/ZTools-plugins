// stream/merge.js — 大文件流式合并 INSERT
// 内存上限 = 表数 × batchSize，与文件大小无关
'use strict'

const fs = require('node:fs')
const readline = require('node:readline')
const path = require('node:path')

const { extractValuesToken } = require('../merge')

/**
 * 流式合并大文件
 * @param {string} inputPath  输入文件路径
 * @param {string} outputPath 输出文件路径
 * @param {{ batchSize?: number, onProgress?: (pct: number) => void }} options
 * @returns {Promise<{ tableCount: number, statementCount: number }>}
 */
async function mergeFileStream(inputPath, outputPath, options = {}) {
  const { batchSize = 1000, onProgress } = options
  const inputSize = fs.statSync(inputPath).size
  let bytesRead = 0
  let lastPct = 0

  const rl = readline.createInterface({
    input: fs.createReadStream(inputPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })

  const writer = fs.createWriteStream(outputPath, { encoding: 'utf8' })

  // groups: Map<tableKey, { tableName, columns, values: string[] }>
  const groups = new Map()
  let statementCount = 0

  const flushGroup = (group) => {
    const colPart = group.columns ? ` ${group.columns}` : ''
    for (let i = 0; i < group.values.length; i += batchSize) {
      const batch = group.values.slice(i, i + batchSize)
      writer.write(`INSERT INTO ${group.tableName}${colPart} VALUES\n${batch.join(',\n')};\n\n`)
      statementCount++
    }
    group.values = []
  }

  for await (const line of rl) {
    bytesRead += Buffer.byteLength(line, 'utf8') + 1
    const pct = Math.min(99, Math.floor((bytesRead / inputSize) * 100))
    if (onProgress && pct > lastPct) { onProgress(pct); lastPct = pct }

    const trimmed = line.trimEnd()
    const m = extractValuesToken(trimmed)
    if (!m) continue

    const { tableName, columns } = m
    const tableKey = `${tableName}|${columns}`

    if (!groups.has(tableKey)) {
      groups.set(tableKey, { tableName, columns, values: [] })
    }
    const group = groups.get(tableKey)
    group.values.push(m.values)

    // 攒满 batchSize 立即写出，控制内存
    if (group.values.length >= batchSize) {
      flushGroup(group)
    }
  }

  // 写出剩余
  for (const group of groups.values()) {
    if (group.values.length > 0) flushGroup(group)
  }

  await new Promise((resolve, reject) => {
    writer.end((err) => (err ? reject(err) : resolve()))
  })

  if (onProgress) onProgress(100)

  return { tableCount: groups.size, statementCount }
}

module.exports = { mergeFileStream }
