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

/** 字段约束：required=必填，unique=同表内不允许重复 */
export interface FieldConstraints {
  required?: boolean
  unique?: boolean
}

interface FieldBase extends FieldConstraints {
  id: string
  name: string
}

export type FieldDef =
  | (FieldBase & { type: 'text' | 'longtext' | 'url'; default?: FieldDefault })
  | (FieldBase & { type: 'list'; default?: FieldDefault })
  | (FieldBase & { type: 'select' | 'multi_select'; options: string[]; default?: FieldDefault })
  | (FieldBase & { type: 'number'; default?: FieldDefault })
  | (FieldBase & { type: 'date'; default?: FieldDefault })
  | (FieldBase & { type: 'checkbox'; default?: FieldDefault })

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
  /** 手动拖动后记下的列宽（列 id → px）；没记的列按内容自适应 */
  columnWidths?: Record<string, number>
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
  | 'isTrue'
  | 'isFalse'
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

/** 「必填」只对有空值语义的类型开放：是否字段的 false 也是有效值 */
export function canBeRequired(field: Pick<FieldDef, 'type'>): boolean {
  return field.type !== 'checkbox'
}

/** 「唯一」只对有单一可比较值的类型开放：多选/列表是集合，是否只有真假两值，做唯一没有实际意义 */
export function canBeUnique(field: Pick<FieldDef, 'type'>): boolean {
  return field.type !== 'list' && field.type !== 'multi_select' && field.type !== 'checkbox'
}
