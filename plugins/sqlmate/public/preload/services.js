// services.js — SQLMate ZTools 插件 Node.js 服务层
// 注意：此文件不可压缩/混淆，保持源码清晰可读
'use strict'

const fs       = require('node:fs')
const path     = require('node:path')
const os       = require('node:os')
const readline = require('node:readline')

// ── 小文件纯函数库 ────────────────────────────────────────────────────────────
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
}
