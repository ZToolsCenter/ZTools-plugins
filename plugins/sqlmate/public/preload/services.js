// services.js — SQLMate ZTools 插件 Node.js 服务层
// 注意：此文件不可压缩/混淆，保持源码清晰可读
'use strict'

const fs       = require('node:fs')
const path     = require('node:path')
const os       = require('node:os')
const readline = require('node:readline')

// ── SQL ↔ CSV/Excel 转换库 ────────────────────────────────────────────────────
const { sqlToCsv, sqlToCsvStream, sqlToXlsx, csvToSql, xlsxToSql } = require('./lib/convert')

// ── 小文件纯函数库 ────────────────────────────────────────────────────────────
const { formatSQL, compressSQL } = require('./lib/format')
const { mergeSQL }          = require('./lib/merge')
const { splitSQL }          = require('./lib/split')
const { segmentSQL }        = require('./lib/segment')
const { scanTables, extractTables } = require('./lib/extract')
const { dedupeSql }         = require('./lib/dedupe')
const { maskSql, maskSqlWithCache } = require('./lib/mask')
const { renameSql }         = require('./lib/rename')
const { offsetSql }         = require('./lib/offset')
const { analyzeSql, statsToMarkdown, statsToCsv, formatBytes } = require('./lib/stats')
const { convertStatements } = require('./lib/convert_stmt')
const { diffSql }           = require('./lib/diff')
const { parseDDL, diffDDL, generateAlterSql } = require('./lib/ddl_diff')

// ── 大文件流式库 ──────────────────────────────────────────────────────────────
const { mergeFileStream }   = require('./lib/stream/merge')
const { splitFileStream }   = require('./lib/stream/split')
const { segmentFileStream } = require('./lib/stream/segment')
const { scanTablesStream, extractTablesStream } = require('./lib/stream/extract')
const { dedupeFileStream }  = require('./lib/stream/dedupe')
const { processFileStream } = require('./lib/stream/common')

// ── 常量 ─────────────────────────────────────────────────────────────────────
const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024 // 10 MB

// ── 内部工具 ──────────────────────────────────────────────────────────────────

/** 判断文件是否超过大文件阈值 */
function isLargeFile(filePath) {
  try { return fs.statSync(filePath).size > LARGE_FILE_THRESHOLD } catch { return false }
}

/**
 * 将小文件处理结果（{ sql, ...stats }）写到 outputPath
 * 并把 stats 部分返回（去掉 sql 字段，保持接口一致）
 */
function writeResult(outputPath, result) {
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, result.sql, { encoding: 'utf-8' })
  }
  const { sql, ...stats } = result
  return { ...stats, sql: outputPath ? undefined : sql }
}

// ─────────────────────────────────────────────────────────────────────────────

window.services = {

  // ── 工具方法 ─────────────────────────────────────────────────────────────────

  formatBytes,
  statsToMarkdown,
  statsToCsv,

  /** 获取文件字节大小（不读内容） */
  getFileSize(filePath) {
    return fs.statSync(filePath).size
  },

  /** 读取小文件内容（≤10MB） */
  readFile(filePath) {
    return fs.readFileSync(filePath, { encoding: 'utf-8' })
  },

  /** 写单个文件 */
  writeFile(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content, { encoding: 'utf-8' })
  },

  /** 批量写多个文件到目录（segment 小文件模式用） */
  writeFiles(dir, files) {
    fs.mkdirSync(dir, { recursive: true })
    for (const { name, content } of files) {
      fs.writeFileSync(path.join(dir, name), content, { encoding: 'utf-8' })
    }
  },

  // ── 合并 ─────────────────────────────────────────────────────────────────────
  /**
   * 合并 INSERT 语句（自动路由）
   *
   * 小文件模式：inputSql 为 SQL 字符串，outputPath 可不传，结果在返回值 .sql 中
   * 大文件模式：inputSql 为文件路径（>10MB），outputPath 必须传
   *
   * @param {string} inputSql      SQL字符串 或 文件路径
   * @param {string} [outputPath]  输出文件路径（大文件必填）
   * @param {{ batchSize?: number, onProgress?: (pct:number)=>void }} [options]
   * @returns {Promise<{ sql?: string, tableCount: number, statementCount: number }>}
   */
  async merge(inputSql, outputPath, options = {}) {
    const { batchSize = 1000, onProgress } = options
    if (isLargeFile(inputSql)) {
      return mergeFileStream(inputSql, outputPath, { batchSize, onProgress })
    }
    const sql = fs.existsSync(inputSql) ? fs.readFileSync(inputSql, 'utf-8') : inputSql
    const result = mergeSQL(sql, { batchSize })
    return writeResult(outputPath, result)
  },

  // ── 拆分 ─────────────────────────────────────────────────────────────────────
  /**
   * 拆分批量 INSERT 为单行（自动路由）
   *
   * @param {string} inputSql      SQL字符串 或 文件路径
   * @param {string} [outputPath]  输出文件路径（大文件必填）
   * @param {{ onProgress?: (pct:number)=>void }} [options]
   * @returns {Promise<{ sql?: string, statementCount: number }>}
   */
  async split(inputSql, outputPath, options = {}) {
    const { onProgress } = options
    if (isLargeFile(inputSql)) {
      return splitFileStream(inputSql, outputPath, { onProgress })
    }
    const sql = fs.existsSync(inputSql) ? fs.readFileSync(inputSql, 'utf-8') : inputSql
    const result = splitSQL(sql)
    return writeResult(outputPath, result)
  },

  // ── 分割 ─────────────────────────────────────────────────────────────────────
  /**
   * 分割 SQL 文件为多个小文件（自动路由）
   *
   * 小文件模式：返回 { files: [{name, content}], fileCount }，可配合 writeFiles 写出
   * 大文件模式：直接写到 outputDir 目录，返回 { fileCount, fileNames }
   *
   * @param {string} inputSql      SQL字符串 或 文件路径
   * @param {string} outputDir     输出目录（大文件必填；小文件可选，传了会自动写出）
   * @param {{ mode: 'count'|'size', count?: number, sizeMB?: number, onProgress?: Function }} [options]
   */
  async segment(inputSql, outputDir, options = {}) {
    const { mode = 'count', count = 10000, sizeMB = 10, onProgress } = options
    if (isLargeFile(inputSql)) {
      return segmentFileStream(inputSql, outputDir, { mode, count, sizeMB, onProgress })
    }
    const sql = fs.existsSync(inputSql) ? fs.readFileSync(inputSql, 'utf-8') : inputSql
    const result = segmentSQL(sql, { mode, count, sizeMB })
    if (outputDir) {
      fs.mkdirSync(outputDir, { recursive: true })
      for (const { name, content } of result.files) {
        fs.writeFileSync(path.join(outputDir, name), content, 'utf-8')
      }
      return { fileCount: result.fileCount, fileNames: result.files.map((f) => f.name) }
    }
    return result
  },

  // ── 按表名抽取 ───────────────────────────────────────────────────────────────
  /**
   * 扫描 SQL 中所有表名（自动路由）
   *
   * @param {string} inputSql  SQL字符串 或 文件路径
   * @param {Function} [onProgress]
   * @returns {Promise<{ name: string, count: number }[]>}
   */
  async scanTables(inputSql, onProgress) {
    if (isLargeFile(inputSql)) {
      return scanTablesStream(inputSql, onProgress)
    }
    const sql = fs.existsSync(inputSql) ? fs.readFileSync(inputSql, 'utf-8') : inputSql
    return scanTables(sql)
  },

  /**
   * 按表名抽取 INSERT（自动路由）
   *
   * @param {string} inputSql      SQL字符串 或 文件路径
   * @param {string[]} tables      要抽取的表名列表
   * @param {string} [outputPath]  输出文件路径（大文件必填）
   * @param {Function} [onProgress]
   * @returns {Promise<{ sql?: string, count: number }>}
   */
  async extractTables(inputSql, tables, outputPath, onProgress) {
    if (isLargeFile(inputSql)) {
      return extractTablesStream(inputSql, outputPath, tables, { onProgress })
    }
    const sql = fs.existsSync(inputSql) ? fs.readFileSync(inputSql, 'utf-8') : inputSql
    const result = extractTables(sql, tables)
    return writeResult(outputPath, result)
  },

  // ── 去重 ─────────────────────────────────────────────────────────────────────
  /**
   * INSERT 去重（自动路由）
   *
   * @param {string} inputSql      SQL字符串 或 文件路径
   * @param {string} [outputPath]  输出文件路径（大文件必填）
   * @param {{ keyColumn?: string, keyColIndex?: number, keepLast?: boolean, onProgress?: Function }} [options]
   * @returns {Promise<{ sql?: string, originalCount, keptCount, removedCount }>}
   */
  async dedupe(inputSql, outputPath, options = {}) {
    const { keyColumn, keyColIndex, keepLast = true, onProgress } = options
    if (isLargeFile(inputSql)) {
      return dedupeFileStream(inputSql, outputPath, { keyColumn, keyColIndex, keepLast, onProgress })
    }
    const sql = fs.existsSync(inputSql) ? fs.readFileSync(inputSql, 'utf-8') : inputSql
    const result = dedupeSql(sql, { keyColumn, keyColIndex, keepLast })
    return writeResult(outputPath, result)
  },

  // ── 脱敏 ─────────────────────────────────────────────────────────────────────
  /**
   * 数据脱敏（自动路由）
   *
   * @param {string} inputSql      SQL字符串 或 文件路径
   * @param {string} [outputPath]  输出文件路径（大文件必填）
   * @param {object[]} rules       脱敏规则
   * @param {Function} [onProgress]
   * @returns {Promise<{ sql?: string, maskedCount: number, warnings: string[] }>}
   */
  async mask(inputSql, outputPath, rules, onProgress) {
    if (isLargeFile(inputSql)) {
      // 跨行共享 cache：同一列 + 同一原始值 → 整个文件中始终生成相同假数据
      const sharedCache = new Map()
      const ctx = { maskedCount: 0, warnings: new Set() }
      const processLine = (line) => {
        const r = maskSqlWithCache(line, rules, sharedCache)
        ctx.maskedCount += r.maskedCount
        r.warnings.forEach((w) => ctx.warnings.add(w))
        return r.sql
      }
      await processFileStream(inputSql, outputPath, processLine, ctx, { onProgress })
      return { maskedCount: ctx.maskedCount, warnings: Array.from(ctx.warnings) }
    }
    const sql = fs.existsSync(inputSql) ? fs.readFileSync(inputSql, 'utf-8') : inputSql
    const result = maskSql(sql, rules)
    return writeResult(outputPath, result)
  },

  // ── 表名/列名替换 ─────────────────────────────────────────────────────────────
  /**
   * 表名/列名替换（自动路由）
   *
   * @param {string} inputSql      SQL字符串 或 文件路径
   * @param {string} [outputPath]  输出文件路径（大文件必填）
   * @param {object[]} rules       替换规则
   * @param {Function} [onProgress]
   * @returns {Promise<{ sql?: string, replacedCount: number }>}
   */
  async rename(inputSql, outputPath, rules, onProgress) {
    if (isLargeFile(inputSql)) {
      const ctx = { replacedCount: 0 }
      const processLine = (line) => {
        const r = renameSql(line, rules)
        ctx.replacedCount += r.replacedCount
        return r.sql
      }
      await processFileStream(inputSql, outputPath, processLine, ctx, { onProgress, expandMultiRow: false })
      return { replacedCount: ctx.replacedCount }
    }
    const sql = fs.existsSync(inputSql) ? fs.readFileSync(inputSql, 'utf-8') : inputSql
    const result = renameSql(sql, rules)
    return writeResult(outputPath, result)
  },

  // ── 主键偏移 ─────────────────────────────────────────────────────────────────
  /**
   * 主键 ID 偏移（自动路由）
   *
   * @param {string} inputSql      SQL字符串 或 文件路径
   * @param {string} [outputPath]  输出文件路径（大文件必填）
   * @param {object[]} rules       偏移规则 [{ column, offset }]
   * @param {Function} [onProgress]
   * @returns {Promise<{ sql?: string, modifiedCount, skippedCount, warnings }>}
   */
  async offset(inputSql, outputPath, rules, onProgress) {
    if (isLargeFile(inputSql)) {
      const ctx = { modifiedCount: 0, skippedCount: 0, warnings: new Set() }
      const processLine = (line) => {
        const r = offsetSql(line, rules)
        ctx.modifiedCount += r.modifiedCount
        ctx.skippedCount += r.skippedCount
        r.warnings.forEach((w) => ctx.warnings.add(w))
        return r.sql
      }
      await processFileStream(inputSql, outputPath, processLine, ctx, { onProgress })
      return { modifiedCount: ctx.modifiedCount, skippedCount: ctx.skippedCount, warnings: Array.from(ctx.warnings) }
    }
    const sql = fs.existsSync(inputSql) ? fs.readFileSync(inputSql, 'utf-8') : inputSql
    const result = offsetSql(sql, rules)
    return writeResult(outputPath, result)
  },

  // ── 文件统计 ─────────────────────────────────────────────────────────────────
  /**
   * SQL 统计分析（自动路由）
   *
   * @param {string} inputSql   SQL字符串 或 文件路径
   * @param {Function} [onProgress]
   * @returns {Promise<SqlStats>}
   */
  async analyze(inputSql, onProgress) {
    if (isLargeFile(inputSql)) {
      const inputSize = fs.statSync(inputSql).size
      let bytesRead = 0, lastPct = 0
      const tableMap = new Map()
      let totalStatements = 0
      const start = Date.now()

      const rl = readline.createInterface({
        input: fs.createReadStream(inputSql, { encoding: 'utf8' }),
        crlfDelay: Infinity,
      })
      for await (const line of rl) {
        bytesRead += Buffer.byteLength(line, 'utf8') + 1
        const pct = Math.min(99, Math.floor((bytesRead / inputSize) * 100))
        if (onProgress && pct > lastPct) { onProgress(pct); lastPct = pct }
        const trimmed = line.trimEnd()
        const m = trimmed.match(/^INSERT\s+INTO\s+`?([^`\s(]+)`?/i)
        if (!m) continue
        totalStatements++
        const lineBytes = Buffer.byteLength(trimmed, 'utf8')
        const ex = tableMap.get(m[1])
        if (ex) { ex.rowCount++; ex.bytes += lineBytes }
        else { tableMap.set(m[1], { rowCount: 1, bytes: lineBytes }) }
      }
      if (onProgress) onProgress(100)
      return {
        tables: Array.from(tableMap.entries()).map(([tableName, { rowCount, bytes }]) =>
          ({ tableName, rowCount, estimatedBytes: bytes })),
        totalRows: totalStatements, totalStatements,
        inputBytes: inputSize, durationMs: Date.now() - start,
      }
    }
    const sql = fs.existsSync(inputSql) ? fs.readFileSync(inputSql, 'utf-8') : inputSql
    return analyzeSql(sql)
  },

  // ── 语句改写 ─────────────────────────────────────────────────────────────────
  /**
   * INSERT 语句改写（自动路由）
   *
   * @param {string} inputSql      SQL字符串 或 文件路径
   * @param {string} [outputPath]  输出文件路径（大文件必填）
   * @param {{ mode: 'update'|'mysql_upsert'|'pg_upsert'|'insert_ignore',
   *            pkColumn?: string, pkColIndex?: number,
   *            excludeColumns?: string[], onProgress?: Function }} options
   * @returns {Promise<{ sql?: string, convertedCount, skippedCount }>}
   */
  async convert(inputSql, outputPath, options = {}) {
    const { onProgress, ...convertOptions } = options
    if (isLargeFile(inputSql)) {
      const ctx = { convertedCount: 0, skippedCount: 0 }
      const processLine = (line) => {
        const r = convertStatements(line, convertOptions)
        ctx.convertedCount += r.convertedCount
        ctx.skippedCount += r.skippedCount
        return r.sql
      }
      await processFileStream(inputSql, outputPath, processLine, ctx, { onProgress })
      return { convertedCount: ctx.convertedCount, skippedCount: ctx.skippedCount }
    }
    const sql = fs.existsSync(inputSql) ? fs.readFileSync(inputSql, 'utf-8') : inputSql
    const result = convertStatements(sql, convertOptions)
    return writeResult(outputPath, result)
  },

  // ── 数据行级 Diff ─────────────────────────────────────────────────────────────
  /**
   * 按主键对比两份 SQL 的数据差异
   * 两边都需要读入内存建 Map，建议文件 ≤100MB
   *
   * @param {string} leftInput    左侧 SQL字符串 或 文件路径
   * @param {string} rightInput   右侧 SQL字符串 或 文件路径
   * @param {{ keyColumn?: string, keyColIndex?: number }} options
   */
  diffData(leftInput, rightInput, options = {}) {
    const { keyColumn, keyColIndex } = options
    const leftSql  = fs.existsSync(leftInput)  ? fs.readFileSync(leftInput,  'utf-8') : leftInput
    const rightSql = fs.existsSync(rightInput) ? fs.readFileSync(rightInput, 'utf-8') : rightInput
    return diffSql(leftSql, rightSql, keyColumn, keyColIndex)
  },

  // ── DDL 结构对比 ──────────────────────────────────────────────────────────────
  /**
   * 对比两张表 DDL 并生成 ALTER SQL（DDL 本身极小，无需流式）
   *
   * @param {string} srcDdl                          源表 DDL（基准）
   * @param {string} dstDdl                          目标表 DDL（待修改）
   * @param {'mysql'|'postgresql'|'oracle'} [dialect]
   * @param {boolean} [includeIndexes]
   * @returns {{ diff: DdlDiffResult, alterSql: string }}
   */
  ddlDiff(srcDdl, dstDdl, dialect = 'mysql', includeIndexes = true) {
    const srcDef = parseDDL(srcDdl)
    const dstDef = parseDDL(dstDdl)
    const diff   = diffDDL(dstDef, srcDef, includeIndexes)
    const alterSql = diff.hasChanges
      ? generateAlterSql(diff, dialect, dstDef.rawTableName)
      : ''
    return { diff, alterSql }
  },

  // ── SQL 格式化 & 压缩 ────────────────────────────────────────────────────────

  /**
   * 格式化 SQL（美化/缩进）
   * 小文件：返回 { sql }；大文件：流式逐语句读取 → 格式化 → 写出
   *
   * @param {string} inputSql      SQL 字符串 或 文件路径
   * @param {string} [outputPath]  输出文件路径（大文件必填）
   * @param {{ indent?: string, keywordCase?: 'upper'|'lower'|'preserve',
   *           linesBetweenStatements?: number, onProgress?: (pct: number) => void }} [options]
   * @returns {Promise<{ sql?: string }>}
   */
  async formatSql(inputSql, outputPath, options = {}) {
    const { onProgress, ...fmtOptions } = options

    if (isLargeFile(inputSql)) {
      // 大文件：逐语句流式格式化
      const inputSize = fs.statSync(inputSql).size
      let bytesRead = 0, lastPct = 0, stmtBuf = '', state = 'normal'
      const writer = fs.createWriteStream(outputPath, { encoding: 'utf8' })
      let firstStmt = true
      const gap = '\n'.repeat((fmtOptions.linesBetweenStatements ?? 1) + 1)

      const rl = readline.createInterface({
        input: fs.createReadStream(inputSql, { encoding: 'utf8' }),
        crlfDelay: Infinity,
      })

      for await (const rawLine of rl) {
        bytesRead += Buffer.byteLength(rawLine, 'utf8') + 1
        const pct = Math.min(99, Math.floor((bytesRead / inputSize) * 100))
        if (onProgress && pct > lastPct) { onProgress(pct); lastPct = pct }

        const line = rawLine.replace(/\r$/, '')
        // 用状态机逐字符扫描检测语句结束
        for (let ci = 0; ci < line.length; ci++) {
          const ch = line[ci]
          stmtBuf += ch
          switch (state) {
            case 'normal':
              if (ch === "'") state = 'string'
              else if (ch === '-' && line[ci + 1] === '-') state = 'line_comment'
              else if (ch === '/' && line[ci + 1] === '*') state = 'block_comment'
              else if (ch === ';') {
                // 语句结束：格式化并写出
                const formatted = formatSQL(stmtBuf.trim(), fmtOptions)
                if (!firstStmt) writer.write(gap)
                writer.write(formatted + '\n')
                firstStmt = false
                stmtBuf = ''
                state = 'normal'
              }
              break
            case 'string':
              if (ch === '\\') { ci++; stmtBuf += line[ci] ?? '' }
              else if (ch === "'" && line[ci + 1] === "'") { ci++; stmtBuf += "'" }
              else if (ch === "'") state = 'normal'
              break
            case 'line_comment': break
            case 'block_comment':
              if (ch === '*' && line[ci + 1] === '/') { ci++; stmtBuf += '/'; state = 'normal' }
              break
          }
        }
        if (state === 'line_comment') state = 'normal'
        stmtBuf += '\n'
      }
      // 末尾无分号的残余
      if (stmtBuf.trim()) {
        const formatted = formatSQL(stmtBuf.trim(), fmtOptions)
        if (!firstStmt) writer.write(gap)
        writer.write(formatted + '\n')
      }

      await new Promise((resolve, reject) => writer.end((err) => (err ? reject(err) : resolve())))
      if (onProgress) onProgress(100)
      return {}
    }

    // 小文件 / 文本输入
    const sql = fs.existsSync(inputSql) ? fs.readFileSync(inputSql, 'utf-8') : inputSql
    return { sql: formatSQL(sql, fmtOptions) }
  },

  /**
   * 压缩 SQL（去注释、去多余空白）
   * 小文件：返回 { sql }；大文件：流式逐行压缩 → 写出
   *
   * @param {string} inputSql      SQL 字符串 或 文件路径
   * @param {string} [outputPath]  输出文件路径（大文件必填）
   * @param {{ removeComments?: boolean, onProgress?: (pct: number) => void }} [options]
   * @returns {Promise<{ sql?: string }>}
   */
  async compressSql(inputSql, outputPath, options = {}) {
    const { onProgress, ...cmpOptions } = options

    if (isLargeFile(inputSql)) {
      // 大文件：逐语句流式压缩
      const inputSize = fs.statSync(inputSql).size
      let bytesRead = 0, lastPct = 0, stmtBuf = '', state = 'normal'
      const writer = fs.createWriteStream(outputPath, { encoding: 'utf8' })

      const rl = readline.createInterface({
        input: fs.createReadStream(inputSql, { encoding: 'utf8' }),
        crlfDelay: Infinity,
      })

      for await (const rawLine of rl) {
        bytesRead += Buffer.byteLength(rawLine, 'utf8') + 1
        const pct = Math.min(99, Math.floor((bytesRead / inputSize) * 100))
        if (onProgress && pct > lastPct) { onProgress(pct); lastPct = pct }

        const line = rawLine.replace(/\r$/, '')
        for (let ci = 0; ci < line.length; ci++) {
          const ch = line[ci]
          stmtBuf += ch
          switch (state) {
            case 'normal':
              if (ch === "'") state = 'string'
              else if (ch === '-' && line[ci + 1] === '-') state = 'line_comment'
              else if (ch === '/' && line[ci + 1] === '*') state = 'block_comment'
              else if (ch === ';') {
                writer.write(compressSQL(stmtBuf.trim(), cmpOptions) + '\n')
                stmtBuf = ''
                state = 'normal'
              }
              break
            case 'string':
              if (ch === '\\') { ci++; stmtBuf += line[ci] ?? '' }
              else if (ch === "'" && line[ci + 1] === "'") { ci++; stmtBuf += "'" }
              else if (ch === "'") state = 'normal'
              break
            case 'line_comment': break
            case 'block_comment':
              if (ch === '*' && line[ci + 1] === '/') { ci++; stmtBuf += '/'; state = 'normal' }
              break
          }
        }
        if (state === 'line_comment') state = 'normal'
        stmtBuf += '\n'
      }
      if (stmtBuf.trim()) writer.write(compressSQL(stmtBuf.trim(), cmpOptions) + '\n')

      await new Promise((resolve, reject) => writer.end((err) => (err ? reject(err) : resolve())))
      if (onProgress) onProgress(100)
      return {}
    }

    const sql = fs.existsSync(inputSql) ? fs.readFileSync(inputSql, 'utf-8') : inputSql
    return { sql: compressSQL(sql, cmpOptions) }
  },

  // ── SQL → CSV / xlsx ──────────────────────────────────────────────────────────

  /**
   * SQL INSERT → CSV 文件（async，大文件流式 O(1) 内存，小文件内存处理）
   * 单表写到 outputPath（.csv），多表写到 outputPath 目录（每表一个 .csv）
   *
   * @param {string} inputSql      SQL 字符串 或 文件路径
   * @param {string} outputPath    输出文件或目录路径
   * @param {{ onProgress?: (info: { bytesRead: number, totalBytes: number, pct: number, rowCount: number }) => void }} [options]
   * @returns {Promise<{ tableCount, rowCount, files: string[] }>}
   */
  async sqlToCsv(inputSql, outputPath, options = {}) {
    const { onProgress } = options
    // 文件输入：直接流式处理，不读入内存，支持 GB 级文件
    if (fs.existsSync(inputSql)) {
      return sqlToCsvStream(inputSql, outputPath, { onProgress })
    }
    // 字符串输入（粘贴的小 SQL）：走内存版
    return sqlToCsv(inputSql, outputPath)
  },

  /**
   * SQL INSERT → xlsx 文件（async，支持真实字节进度）
   *
   * @param {string} inputSql      SQL 字符串 或 文件路径
   * @param {string} outputPath    输出 .xlsx 文件路径
   * @param {{ onProgress?: (info: { bytesRead: number, totalBytes: number, pct: number }) => void }} [options]
   * @returns {Promise<{ tableCount, rowCount }>}
   */
  async sqlToXlsx(inputSql, outputPath, options = {}) {
    const { onProgress } = options
    const sql = await this._readFileWithProgress(inputSql, onProgress)
    return sqlToXlsx(sql, outputPath)
  },

  /**
   * 内部：用 readline 流式读取文件并上报真实字节进度，返回完整字符串。
   * 每行读完后让出事件循环（setTimeout 0），React 可正常重渲染。
   * 若 input 不是存在的文件路径，直接返回原字符串。
   * @private
   */
  async _readFileWithProgress(input, onProgress) {
    if (!fs.existsSync(input)) return input  // 已是 SQL 字符串
    if (!onProgress) return fs.readFileSync(input, 'utf-8')

    const totalBytes = fs.statSync(input).size
    let bytesRead = 0
    const chunks = []
    // 按时间间隔触发，避免百分比跳变和过度让出
    let lastNotifyTime = Date.now()
    const NOTIFY_INTERVAL_MS = 80

    const rl = readline.createInterface({
      input: fs.createReadStream(input, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    })

    for await (const line of rl) {
      chunks.push(line)
      bytesRead += Buffer.byteLength(line, 'utf8') + 1
      const now = Date.now()
      if (now - lastNotifyTime >= NOTIFY_INTERVAL_MS) {
        const pct = Math.min(99, Math.floor((bytesRead / totalBytes) * 100))
        onProgress({ bytesRead, totalBytes, pct })
        lastNotifyTime = now
        // 让出事件循环，React 可重渲染进度条
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }

    onProgress({ bytesRead: totalBytes, totalBytes, pct: 100 })
    return chunks.join('\n')
  },

  // ── CSV / xlsx → SQL ──────────────────────────────────────────────────────────

  /**
   * CSV 文件 → SQL INSERT 语句（async，逐行读取上报进度）
   *
   * @param {string} csvPath       CSV 文件路径
   * @param {{ tableName: string, noHeader?: boolean, batchSize?: number, detectNumeric?: boolean,
   *           onProgress?: (info: { rowsRead: number, totalRows: number, pct: number }) => void }} options
   * @returns {Promise<{ sql: string, rowCount: number }>}
   */
  async csvToSql(csvPath, options) {
    const { onProgress, ...convertOptions } = options || {}
    if (!onProgress) {
      const csvText = fs.readFileSync(csvPath, 'utf-8')
      const sql = csvToSql(csvText, convertOptions)
      const rowCount = sql ? sql.split('\n').filter((l) => l.startsWith('INSERT')).length : 0
      return { sql, rowCount }
    }

    // 流式逐行读取，上报真实进度
    const totalBytes = fs.statSync(csvPath).size
    let bytesRead = 0, lastPct = -1
    const lines = []

    const rl = readline.createInterface({
      input: fs.createReadStream(csvPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    })

    for await (const line of rl) {
      lines.push(line)
      bytesRead += Buffer.byteLength(line, 'utf8') + 1
      const pct = Math.min(99, Math.floor((bytesRead / totalBytes) * 100))
      const rowsRead = lines.length
      if (pct > lastPct) {
        onProgress({ rowsRead, totalRows: rowsRead, pct })
        lastPct = pct
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }

    const csvText = lines.join('\n')
    const sql = csvToSql(csvText, convertOptions)
    const rowCount = sql ? sql.split('\n').filter((l) => l.startsWith('INSERT')).length : 0
    onProgress({ rowsRead: lines.length, totalRows: lines.length, pct: 100 })
    return { sql, rowCount }
  },

  /**
   * xlsx 文件 → SQL INSERT 语句（async，分 Sheet 上报进度）
   *
   * @param {string} xlsxPath      xlsx 文件路径
   * @param {{ noHeader?: boolean, batchSize?: number, detectNumeric?: boolean,
   *           tableNameOverride?: string,
   *           onProgress?: (info: { rowsRead: number, totalRows: number, pct: number }) => void }} options
   * @returns {Promise<{ sql: string, tableCount: number, rowCount: number }>}
   */
  async xlsxToSql(xlsxPath, options = {}) {
    const { onProgress, ...convertOptions } = options
    if (!onProgress) return xlsxToSql(xlsxPath, convertOptions)

    // xlsx 解析同步，用 setTimeout(0) 在分 Sheet 处理间让出事件循环上报进度
    const XLSX = require('./lib/xlsx')
    const wb = XLSX.readFile(xlsxPath)

    // 第一遍统计总行数
    let totalRows = 0
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name]
      if (!ws['!ref']) continue
      const range = XLSX.utils.decode_range(ws['!ref'])
      totalRows += Math.max(0, range.e.r - range.s.r)
    }
    if (totalRows === 0) totalRows = 1

    onProgress({ rowsRead: 0, totalRows, pct: 0 })
    await new Promise((resolve) => setTimeout(resolve, 0))

    // 逐 Sheet 处理，每 Sheet 完成后上报进度
    const { noHeader = false, batchSize = 0, detectNumeric = true, tableNameOverride } = convertOptions
    const NUMERIC_RE = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/
    const allSql = []
    let processedRows = 0

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName]
      const tableName = tableNameOverride || sheetName.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_')
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
      if (aoa.length === 0) continue

      let headers, dataRows
      if (noHeader) {
        const colCount = aoa[0].length
        headers = Array.from({ length: colCount }, (_, i) => `col${i + 1}`)
        dataRows = aoa
      } else {
        headers = aoa[0].map((h) => String(h))
        dataRows = aoa.slice(1)
      }

      const colList = headers.map((h) => `\`${String(h).replace(/`/g, '')}\``).join(', ')
      const safeTable = tableName.replace(/`/g, '')
      const isNumeric = headers.map((_, ci) => {
        if (!detectNumeric) return false
        return dataRows.every((row) => { const v = row[ci]; return v === '' || v === null || v === undefined || NUMERIC_RE.test(String(v)) })
      })
      const fmtVal = (val, ci) => {
        if (val === '' || val === null || val === undefined) return 'NULL'
        const s = String(val)
        return isNumeric[ci] ? s : `'${s.replace(/'/g, "''")}'`
      }

      const size = batchSize > 0 ? batchSize : 0
      if (!size) {
        for (const row of dataRows) {
          allSql.push(`INSERT INTO \`${safeTable}\` (${colList}) VALUES (${headers.map((_, ci) => fmtVal(row[ci], ci)).join(', ')});`)
          processedRows++
        }
      } else {
        for (let i = 0; i < dataRows.length; i += size) {
          const batch = dataRows.slice(i, i + size)
          const rowClauses = batch.map((row) => `  (${headers.map((_, ci) => fmtVal(row[ci], ci)).join(', ')})`).join(',\n')
          allSql.push(`INSERT INTO \`${safeTable}\` (${colList}) VALUES\n${rowClauses};`)
          processedRows += batch.length
        }
      }

      const pct = Math.min(99, Math.floor((processedRows / totalRows) * 100))
      onProgress({ rowsRead: processedRows, totalRows, pct })
      // 每个 Sheet 处理完让出事件循环
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    onProgress({ rowsRead: processedRows, totalRows, pct: 100 })
    return { sql: allSql.join('\n\n'), tableCount: wb.SheetNames.length, rowCount: processedRows }
  },
}
