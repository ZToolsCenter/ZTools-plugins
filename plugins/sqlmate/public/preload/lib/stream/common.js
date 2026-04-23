// stream/common.js — 通用流式逐行处理工厂
// 用于 mask / rename / offset / convert_stmt / stats 等逐行处理功能
'use strict'

const fs = require('node:fs')
const readline = require('node:readline')
const { splitMultiRowInsert } = require('../dedupe')

/**
 * 通用流式处理：逐行读取 → 展开多行 INSERT → 每行调用 processLine → 写出
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

  for await (const line of rl) {
    bytesRead += Buffer.byteLength(line, 'utf8') + 1
    const pct = Math.min(99, Math.floor((bytesRead / inputSize) * 100))
    if (onProgress && pct > lastPct) { onProgress(pct); lastPct = pct }

    const lines = expandMultiRow ? splitMultiRowInsert(line.trimEnd()) : [line.trimEnd()]
    for (const l of lines) {
      const out = processLine(l, ctx)
      writer.write(out + '\n')
    }
  }

  await new Promise((resolve, reject) => writer.end((err) => (err ? reject(err) : resolve())))
  if (onProgress) onProgress(100)
}

module.exports = { processFileStream }
