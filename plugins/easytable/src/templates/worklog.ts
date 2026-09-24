import type { TableSchema, FieldType } from '../types/table.ts'
import { createField } from '../domain/fieldTypes.ts'
import { generateId } from '../utils/id.ts'

export function createEmptyTable(name = '新表格'): TableSchema {
  const now = Date.now()
  const fields = [
    createField('名称', 'text' as FieldType),
    createField('备注', 'longtext' as FieldType)
  ]
  return {
    id: generateId('tbl'),
    name,
    fields,
    createdAt: now,
    updatedAt: now,
    showCreatedAt: true,
    showUpdatedAt: true
  }
}
