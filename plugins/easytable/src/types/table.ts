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

/** 字段默认值：新建行预填；新增字段保存时可选回填到已有数据（回填与否是一次性决策，不持久化） */
export type FieldDefault = FieldValue

export type FieldDef =
  | ({ id: string; name: string; type: 'text' | 'longtext' | 'url'; default?: FieldDefault })
  | ({ id: string; name: string; type: 'list'; default?: FieldDefault })
  | ({
      id: string
      name: string
      type: 'select' | 'multi_select'
      options: string[]
      default?: FieldDefault
    })
  | ({ id: string; name: string; type: 'number'; default?: FieldDefault })
  | ({ id: string; name: string; type: 'date'; default?: FieldDefault })
  | ({ id: string; name: string; type: 'checkbox'; default?: FieldDefault })

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

export type FilterOp =
  | 'empty'
  | 'notEmpty'
  | 'eq'
  | 'contains'
  | 'today'
  | 'thisWeek'
  | 'thisMonth'

/** 高级筛选条件；多条之间 AND */
export interface FilterCond {
  /** 条件实例 id（列表 key） */
  key: string
  fieldId: string
  op: FilterOp
  /** 仅 eq / contains 使用 */
  value: string
}

export interface AppMeta {
  version: 1
  tables: TableSchema[]
  activeTableId: string
  multiSeparator: string
  /** 快捷记一笔上次使用的表 */
  quickTableId?: string
  /** 行高样式：fixed=固定行高（单行省略），auto=自适应（随内容撑高）；默认 fixed */
  rowHeightMode?: 'fixed' | 'auto'
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
