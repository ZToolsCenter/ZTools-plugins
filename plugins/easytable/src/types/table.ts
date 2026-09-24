export type FieldType =
  | 'text'
  | 'longtext'
  | 'list'
  | 'select'
  | 'multi_select'
  | 'url'
  | 'number'
  | 'date'
  | 'checkbox'

export type FieldValue = string | number | boolean | string[] | null

export type FieldDef =
  | { id: string; name: string; type: 'text' | 'longtext' | 'url' }
  | { id: string; name: string; type: 'list' }
  | { id: string; name: string; type: 'select' | 'multi_select'; options: string[] }
  | { id: string; name: string; type: 'number' }
  | { id: string; name: string; type: 'date' }
  | { id: string; name: string; type: 'checkbox' }

export interface TableSchema {
  id: string
  name: string
  fields: FieldDef[]
  createdAt: number
  updatedAt: number
  /** 显示系统列「创建时间」（默认显示） */
  showCreatedAt?: boolean
  /** 显示系统列「修改时间」（默认显示） */
  showUpdatedAt?: boolean
}

export const CREATED_AT_FIELD_ID = '__createdAt'
export const UPDATED_AT_FIELD_ID = '__updatedAt'

export function isSystemFieldId(id: string): boolean {
  return id === CREATED_AT_FIELD_ID || id === UPDATED_AT_FIELD_ID
}

export interface Row {
  id: string
  tableId: string
  values: Record<string, FieldValue>
  createdAt: number
  updatedAt: number
}

export interface AppMeta {
  version: 1
  tables: TableSchema[]
  activeTableId: string
  multiSeparator: string
  /** 快捷记一笔上次使用的表 */
  quickTableId?: string
}

export interface BackupFile {
  app: 'easytable'
  version: 1
  exportedAt: string
  multiSeparator: string
  tables: Array<{ schema: TableSchema; rows: Row[] }>
}

export function hasOptions(
  field: FieldDef
): field is Extract<FieldDef, { type: 'select' | 'multi_select' }> {
  return field.type === 'select' || field.type === 'multi_select'
}

export function isMultiValue(field: FieldDef): boolean {
  return field.type === 'list' || field.type === 'multi_select'
}
