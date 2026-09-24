import type { BackupFile, Row, TableSchema } from '../../types/table.ts'

export function toBackup(
  tables: TableSchema[],
  rowsByTable: Record<string, Row[]>,
  multiSeparator: string
): BackupFile {
  return {
    app: 'easytable',
    version: 1,
    exportedAt: new Date().toISOString(),
    multiSeparator,
    tables: tables.map((schema) => ({
      schema,
      rows: rowsByTable[schema.id] ?? []
    }))
  }
}

export function serializeBackup(backup: BackupFile): string {
  return JSON.stringify(backup, null, 2)
}

export function parseBackup(text: string): BackupFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('不是合法的 JSON 文件')
  }
  if (!raw || typeof raw !== 'object') throw new Error('备份内容为空')
  const obj = raw as Partial<BackupFile>
  if (obj.app !== 'easytable') throw new Error('不是 easytable 备份文件')
  if (!Array.isArray(obj.tables)) throw new Error('备份缺少 tables')
  for (const t of obj.tables) {
    if (!t?.schema?.id || !Array.isArray(t.schema.fields) || !Array.isArray(t.rows)) {
      throw new Error('备份表结构不完整')
    }
  }
  return {
    app: 'easytable',
    version: 1,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
    multiSeparator: typeof obj.multiSeparator === 'string' ? obj.multiSeparator : '、',
    tables: obj.tables.map((t) => ({
      schema: t.schema as TableSchema,
      rows: t.rows as Row[]
    }))
  }
}
