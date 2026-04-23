/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

// 补全 ZToolsApi 缺失的方法（declaration merging）
declare global {
  interface ZToolsApi {
    getPathForFile(file: File): string
  }
}

// ── services.js 类型声明 ──────────────────────────────────────────────────────

declare global {
  interface TableStat {
    tableName: string
    rowCount: number
    estimatedBytes: number
  }

  interface SqlStats {
    tables: TableStat[]
    totalRows: number
    totalStatements: number
    inputBytes: number
    durationMs: number
  }

  interface DiffRow {
    status: 'added' | 'removed' | 'modified' | 'unchanged'
    tableName: string
    keyValue: string
    leftValues: string[] | null
    rightValues: string[] | null
    columns: string[] | null
    changedColumns: string[]
  }

  interface DiffResult {
    rows: DiffRow[]
    addedCount: number
    removedCount: number
    modifiedCount: number
    unchangedCount: number
  }

  interface ColumnDef {
    name: string
    rawName: string
    fullDef: string
  }

  interface IndexDef {
    name: string
    rawName: string
    type: 'PRIMARY' | 'UNIQUE' | 'INDEX' | 'FULLTEXT' | 'SPATIAL'
    columns: string[]
  }

  interface ColumnChange {
    kind: 'added' | 'removed' | 'modified'
    column: ColumnDef
    fromColumn?: ColumnDef
  }

  interface IndexChange {
    kind: 'added' | 'removed' | 'modified'
    index: IndexDef
    fromIndex?: IndexDef
  }

  interface DdlDiffResult {
    fromTableName: string
    toTableName: string
    columnChanges: ColumnChange[]
    indexChanges: IndexChange[]
    hasChanges: boolean
  }

  type MaskType = 'phone' | 'id_card' | 'email' | 'name' | 'custom_mask' | 'regex_replace'

  interface MaskRule {
    column: string
    type: MaskType
    customValue?: string
    regexPattern?: string
    regexReplace?: string
  }

  interface RenameRule {
    type: 'table' | 'column' | 'prefix'
    from: string
    to: string
  }

  interface OffsetRule {
    column: string
    colIndex?: number
    offset: number
  }

  type ConvertMode = 'update' | 'mysql_upsert' | 'pg_upsert' | 'insert_ignore'
  type DdlDialect  = 'mysql' | 'postgresql' | 'oracle'

  interface Services {
    // 工具
    formatBytes(bytes: number): string
    statsToMarkdown(stats: SqlStats): string
    statsToCsv(stats: SqlStats): string
    readFile(filePath: string): string
    writeFile(filePath: string, content: string): void
    writeFiles(dir: string, files: { name: string; content: string }[]): void

    // 合并
    merge(
      inputSql: string,
      outputPath?: string | null,
      options?: { batchSize?: number; onProgress?: (pct: number) => void }
    ): Promise<{ sql?: string; tableCount: number; statementCount: number }>

    // 拆分
    split(
      inputSql: string,
      outputPath?: string | null,
      options?: { onProgress?: (pct: number) => void }
    ): Promise<{ sql?: string; statementCount: number }>

    // 分割
    segment(
      inputSql: string,
      outputDir?: string | null,
      options?: { mode?: 'count' | 'size'; count?: number; sizeMB?: number; onProgress?: (pct: number) => void }
    ): Promise<{ files?: { name: string; content: string }[]; fileCount: number; fileNames?: string[] }>

    // 按表名抽取
    scanTables(inputSql: string, onProgress?: (pct: number) => void): Promise<{ name: string; count: number }[]>
    extractTables(
      inputSql: string,
      tables: string[],
      outputPath?: string | null,
      onProgress?: (pct: number) => void
    ): Promise<{ sql?: string; count: number }>

    // 去重
    dedupe(
      inputSql: string,
      outputPath?: string | null,
      options?: { keyColumn?: string; keyColIndex?: number; keepLast?: boolean; onProgress?: (pct: number) => void }
    ): Promise<{ sql?: string; originalCount: number; keptCount: number; removedCount: number }>

    // 脱敏
    mask(
      inputSql: string,
      outputPath?: string | null,
      rules?: MaskRule[],
      onProgress?: (pct: number) => void
    ): Promise<{ sql?: string; maskedCount: number; warnings: string[] }>

    // 替换
    rename(
      inputSql: string,
      outputPath?: string | null,
      rules?: RenameRule[],
      onProgress?: (pct: number) => void
    ): Promise<{ sql?: string; replacedCount: number }>

    // 偏移
    offset(
      inputSql: string,
      outputPath?: string | null,
      rules?: OffsetRule[],
      onProgress?: (pct: number) => void
    ): Promise<{ sql?: string; modifiedCount: number; skippedCount: number; warnings: string[] }>

    // 统计
    analyze(inputSql: string, onProgress?: (pct: number) => void): Promise<SqlStats>

    // 改写
    convert(
      inputSql: string,
      outputPath?: string | null,
      options?: { mode: ConvertMode; pkColumn?: string; pkColIndex?: number; excludeColumns?: string[]; onProgress?: (pct: number) => void }
    ): Promise<{ sql?: string; convertedCount: number; skippedCount: number }>

    // 数据 Diff
    diffData(
      leftInput: string,
      rightInput: string,
      options?: { keyColumn?: string; keyColIndex?: number }
    ): DiffResult

    // DDL 对比
    ddlDiff(
      srcDdl: string,
      dstDdl: string,
      dialect?: DdlDialect,
      includeIndexes?: boolean
    ): { diff: DdlDiffResult; alterSql: string }
  }

  interface Window {
    services: Services
  }
}

export {}
