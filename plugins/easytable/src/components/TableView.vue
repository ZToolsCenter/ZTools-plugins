<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, ElLoading } from 'element-plus'
import type { TableInstance } from 'element-plus'
import type { FieldDef, FieldValue, FilterCond, FilterOp, Row, TableSchema } from '../types/table'
import {
  CREATED_AT_FIELD_ID,
  UPDATED_AT_FIELD_ID,
  hasOptions
} from '../types/table'
import { displayValue, defaultValue, searchTextOf, backfillField, coerceRowsToFields, coerceFieldValue, batchSetFieldValue, addFieldOptions, collectFieldOptions } from '../domain/fieldTypes'
import { validateBatchSetValue, validateRowValues } from '../domain/constraints'
import {
  cellTextOf,
  estimateColumnWidth,
  isValidColumnWidth,
  pruneColumnWidths
} from '../domain/columnWidth'
import {
  filterableFields,
  opsForField,
  matchAll
} from '../domain/filters'
import { rowsToCsv, rowsToTsv } from '../domain/codec/tableCodec'
import { toBackup, serializeBackup } from '../domain/codec/jsonBackup'
import { copyText, openExternal } from '../utils/copy'
import { useStore } from '../composables/useStore'
import RowFormDrawer from './RowFormDrawer.vue'
import FieldManagerDialog from './FieldManagerDialog.vue'
import ImportDialog from './ImportDialog.vue'
import BatchEditDialog from './BatchEditDialog.vue'
import type { BackupFile } from '../types/table'
import { parseBackup } from '../domain/codec/jsonBackup'

const store = useStore()
const {
  tables,
  activeTable,
  activeRows,
  multiSeparator,
  rowHeightMode,
  ensureBootstrapped,
  setActiveTable,
  addTable,
  updateTableSchema,
  removeTable,
  createRow,
  saveRow,
  deleteRows,
  clearTableRows,
  importBackupTables,
  collectAllRows,
  setRowHeightMode,
  setColumnWidths,
  backfillRows,
  replaceRows
} = store

const keyword = ref('')
/** 表格实例：勾选状态由 el-table 自己持有（列上开了 reserve-selection），清空必须走它 */
const gridRef = ref<TableInstance>()
const sortFieldId = ref<string | null>(null)
const sortDir = ref<'asc' | 'desc'>('asc')
const selectedIds = ref<Set<string>>(new Set())
const showRowForm = ref(false)
const editingRow = ref<Row | null>(null)
const showFieldMgr = ref(false)
const showImport = ref(false)
const showBatchEdit = ref(false)
const batchApplying = ref(false)
/** 高级筛选：AND 条件组（替代旧的单字段筛选） */
const filters = ref<FilterCond[]>([])
const filterOpen = ref(false)
const page = ref(1)
const pageSize = ref(50)

ensureBootstrapped()
// 窗口高度
try {
  ;(window as any).ztools?.setExpendHeight?.(620)
} catch {
  // ignore
}

const fields = computed<FieldDef[]>(() => activeTable.value?.fields ?? [])
/** 展示列 = 用户字段 + 可选系统时间列 */
const displayFields = computed<FieldDef[]>(() => {
  const list: FieldDef[] = [...fields.value]
  const t = activeTable.value
  if (t?.showCreatedAt !== false) {
    list.push({ id: CREATED_AT_FIELD_ID, name: '创建时间', type: 'text' })
  }
  if (t?.showUpdatedAt !== false) {
    list.push({ id: UPDATED_AT_FIELD_ID, name: '修改时间', type: 'text' })
  }
  return list
})

function rawSortValue(row: Row, sid: string): string | number {
  if (sid === CREATED_AT_FIELD_ID) return row.createdAt || 0
  if (sid === UPDATED_AT_FIELD_ID) return row.updatedAt || 0
  const field = fields.value.find((f) => f.id === sid)
  const v = row.values[sid]
  if (field?.type === 'number') return typeof v === 'number' ? v : -Infinity
  return field ? displayValue(field, v, multiSeparator.value) : String(v ?? '')
}

/** 默认：创建时间 ↓，同值再比更新时间 ↓ */
function defaultCompare(a: Row, b: Row): number {
  return (b.createdAt || 0) - (a.createdAt || 0) || (b.updatedAt || 0) - (a.updatedAt || 0)
}

function onSortChange({ prop, order }: { prop: string | null; order: string | null }) {
  if (!prop || !order) {
    sortFieldId.value = null
    sortDir.value = 'asc'
    return
  }
  sortFieldId.value = prop
  sortDir.value = order === 'descending' ? 'desc' : 'asc'
}

const filteredRows = computed(() => {
  let list = activeRows.value
  const kw = keyword.value.trim().toLowerCase()
  if (kw) {
    list = list.filter((r) =>
      searchTextOf(fields.value, r.values, multiSeparator.value).includes(kw)
    )
  }
  if (filters.value.length) {
    const now = Date.now()
    list = list.filter((r) => matchAll(filters.value, r, fields.value, now, multiSeparator.value))
  }
  const sid = sortFieldId.value
  const dir = sortDir.value === 'asc' ? 1 : -1
  list = [...list].sort((a, b) => {
    if (sid) {
      const av = rawSortValue(a, sid)
      const bv = rawSortValue(b, sid)
      const field = fields.value.find((f) => f.id === sid)
      let cmp = 0
      if (
        (field?.type === 'number' || sid === CREATED_AT_FIELD_ID || sid === UPDATED_AT_FIELD_ID) &&
        typeof av === 'number' &&
        typeof bv === 'number'
      ) {
        cmp = av - bv
      } else {
        cmp = String(av).localeCompare(String(bv), 'zh')
      }
      if (cmp !== 0) return cmp * dir
    }
    return defaultCompare(a, b)
  })
  return list
})

const pageCount = computed(() =>
  Math.max(1, Math.ceil(filteredRows.value.length / pageSize.value))
)

const pageRows = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filteredRows.value.slice(start, start + pageSize.value)
})

/**
 * 批量修改的作用范围：勾选过就只改勾选的（取当前列表内的交集，避免改到看不见的行），
 * 没勾选则视为全部 —— 即当前列表里的所有行（有筛选时就是筛选结果）。
 */
const batchTargetRows = computed(() => {
  const list = filteredRows.value
  if (!selectedIds.value.size) return list
  return list.filter((r) => selectedIds.value.has(r.id))
})

watch(
  [
    keyword,
    () => filters.value.map((c) => c.fieldId + c.op + c.value).join('|'),
    sortFieldId,
    pageSize,
    () => activeTable.value?.id
  ],
  () => {
    page.value = 1
  }
)

const allSelected = computed({
  get: () =>
    pageRows.value.length > 0 &&
    pageRows.value.every((r) => selectedIds.value.has(r.id)),
  set: (v: boolean) => {
    const next = new Set(selectedIds.value)
    for (const r of pageRows.value) {
      if (v) next.add(r.id)
      else next.delete(r.id)
    }
    selectedIds.value = next
  }
})

function cellText(field: FieldDef, row: Row): string {
  return cellTextOf(field, row, multiSeparator.value)
}

function multiTags(field: FieldDef, row: Row): string[] {
  const v = row.values[field.id]
  return Array.isArray(v) ? v : []
}

/** 估算默认列宽的采样行数：只看前 N 行，大表不必为了量宽度整表扫一遍 */
const WIDTH_SAMPLE_ROWS = 300

/** 按内容长度估算的默认列宽：没手动拖过的列用它当 min-width */
const autoWidths = computed<Record<string, number>>(() => {
  const sample = activeRows.value.slice(0, WIDTH_SAMPLE_ROWS)
  const map: Record<string, number> = {}
  for (const f of displayFields.value) {
    map[f.id] = estimateColumnWidth(f, sample, multiSeparator.value)
  }
  return map
})

/** 手动拖动记下的列宽；没记过或值不合法时返回 undefined（回到自适应） */
function manualWidth(id: string): number | undefined {
  const w = activeTable.value?.columnWidths?.[id]
  return isValidColumnWidth(w) ? Math.round(w) : undefined
}

/**
 * 拖动列宽：记到当前表上，下次打开沿用。
 * 没拖过的列保持 min-width，由 el-table 按内容比例分配剩余宽度。
 */
function onHeaderDragend(newWidth: number, _oldWidth: number, column: { property?: string }) {
  const table = activeTable.value
  const id = column?.property
  if (!table || typeof id !== 'string' || !displayFields.value.some((f) => f.id === id)) return
  const w = Math.round(newWidth)
  if (!Number.isFinite(w) || w <= 0) return
  setColumnWidths(table.id, { ...(table.columnWidths ?? {}), [id]: w })
}

/** 清掉记下的列宽，回到「按内容自适应」 */
function resetColumnWidths() {
  const table = activeTable.value
  if (!table) return
  if (!Object.keys(table.columnWidths ?? {}).length) {
    ElMessage.info('列宽已是按内容自适应')
    return
  }
  setColumnWidths(table.id, {})
  ElMessage.success('列宽已恢复为按内容自适应')
}

/**
 * 悬停提示内容：默认取单元格 innerText，标签会被粘成一串，
 * 这里统一用展示文本（多值按分隔符连接），和「复制/导出」看到的一致。
 */
function colTooltip({ row, column }: { row: Row; column: { property?: string } }): string {
  const f = displayFields.value.find((x) => x.id === column?.property)
  return f ? cellText(f, row) : ''
}

function openUrl(url: string) {
  const u = (url || '').trim()
  if (!u) return
  openExternal(/^https?:\/\//i.test(u) ? u : `https://${u}`)
}

function openCreate() {
  if (!activeTable.value) {
    addTable('记录')
    showFieldMgr.value = true
    ElMessage.info('已新建表，请先配置字段')
    return
  }
  editingRow.value = null
  showRowForm.value = true
}

function openEdit(row: Row) {
  editingRow.value = row
  showRowForm.value = true
}

async function copyRow(row: Row) {
  const table = activeTable.value
  if (!table) return
  const text = rowsToTsv(displayFields.value, [row], {
    includeHeader: false,
    multiSep: multiSeparator.value
  })
  const ok = await copyText(text)
  ElMessage[ok ? 'success' : 'error'](ok ? '已复制该行' : '复制失败')
}

function onSaveRow(values: Record<string, FieldValue>, rowId: string | null) {
  const table = activeTable.value
  if (!table) return
  // 补默认值
  const nextValues: Record<string, FieldValue> = {}
  for (const f of table.fields) nextValues[f.id] = values[f.id] ?? defaultValue(f.type)
  // 表单里已经校验过；这里兜底一次，保证从任何路径写入都过约束
  const issues = validateRowValues(table.fields, nextValues, activeRows.value, rowId)
  if (issues.length) {
    ElMessage.error(issues[0].message)
    return
  }
  // 自动把单选/多选新值写进 schema 的选项（校验通过后再改 schema）
  let schemaChanged = false
  for (const f of table.fields) {
    if (addFieldOptions(f, nextValues[f.id])) schemaChanged = true
  }
  if (schemaChanged) updateTableSchema({ ...table, fields: [...table.fields] })
  if (rowId) saveRow(rowId, table.id, nextValues)
  else createRow(table.id, nextValues)
  ElMessage.success('已保存')
}

async function onDeleteSelected() {
  const table = activeTable.value
  if (!table || !selectedIds.value.size) return
  try {
    await ElMessageBox.confirm(`删除选中的 ${selectedIds.value.size} 条记录？`, '删除', {
      type: 'warning'
    })
  } catch {
    return
  }
  deleteRows(table.id, [...selectedIds.value])
  resetSelection()
  ElMessage.success('已删除')
}

/** 打开批量修改：没勾选视为全部，范围的说明交给对话框展示 */
function openBatchEdit() {
  const table = activeTable.value
  if (!table) return
  if (!table.fields.length) {
    ElMessage.info('当前表还没有字段，请先在「表设置」里添加字段')
    return
  }
  if (!batchTargetRows.value.length) {
    ElMessage.warning(
      selectedIds.value.size ? '勾选的记录不在当前列表里' : '当前没有可修改的记录'
    )
    return
  }
  showBatchEdit.value = true
}

/** 批量修改：把范围内的记录某字段统一改成同一个值（对话框已确认过字段与值） */
async function onBatchApply(fieldId: string, rawValue: FieldValue) {
  if (batchApplying.value) return
  const table = activeTable.value
  const field = table?.fields.find((f) => f.id === fieldId)
  if (!table || !field) return
  const targetIds = new Set(batchTargetRows.value.map((r) => r.id))
  if (!targetIds.size) return
  // 按字段类型归一化，保证存下的值和界面显示的一致
  const value = coerceFieldValue(field, rawValue)
  const issue = validateBatchSetValue(field, value, activeRows.value, targetIds)
  if (issue) {
    ElMessage.warning(issue.message)
    return
  }
  const shown = displayValue(field, value, multiSeparator.value) || '（空）'
  const label = shown.length > 30 ? `${shown.slice(0, 30)}…` : shown
  batchApplying.value = true
  try {
    try {
      await ElMessageBox.confirm(
        `将 ${targetIds.size} 条记录的「${field.name}」改为「${label}」。此操作不可撤销。`,
        '批量修改',
        { type: 'warning', confirmButtonText: '修改', cancelButtonText: '取消' }
      )
    } catch {
      return
    }
    showBatchEdit.value = false
    const result = batchSetFieldValue(activeRows.value, fieldId, value, targetIds)
    if (!result) {
      ElMessage.info(`这些记录的「${field.name}」已经是该值`)
      return
    }
    // 新值若是单选/多选里的新选项，一并收进字段选项
    if (addFieldOptions(field, value)) {
      updateTableSchema({ ...table, fields: [...table.fields] })
    }
    await replaceRows(table.id, result.rows)
    ElMessage.success(`已修改 ${result.changedRows} 条记录`)
  } catch (e: any) {
    ElMessage.error(e?.message || '批量修改失败')
  } finally {
    batchApplying.value = false
  }
}

async function copySelectedAsTsv(includeHeader = true) {
  const table = activeTable.value
  if (!table) return
  const rows = selectedIds.value.size
    ? filteredRows.value.filter((r) => selectedIds.value.has(r.id))
    : filteredRows.value
  if (!rows.length) {
    ElMessage.warning('没有可复制的行')
    return
  }
  const text = rowsToTsv(displayFields.value, rows, {
    includeHeader,
    multiSep: multiSeparator.value
  })
  const ok = await copyText(text)
  ElMessage[ok ? 'success' : 'error'](ok ? `已复制 ${rows.length} 行，可粘贴到 Excel` : '复制失败')
}

function exportTsvFile() {
  const table = activeTable.value
  if (!table) return
  const text = rowsToTsv(displayFields.value, filteredRows.value, { multiSep: multiSeparator.value })
  saveTextAs(text, `${table.name || 'easytable'}.tsv`, 'tsv')
}

function exportCsvFile() {
  const table = activeTable.value
  if (!table) return
  const text = rowsToCsv(displayFields.value, filteredRows.value, { multiSep: multiSeparator.value })
  saveTextAs(text, `${table.name || 'easytable'}.csv`, 'csv')
}

function exportJson() {
  const rowsByTable = collectAllRows()
  const backup = toBackup(tables.value, rowsByTable, multiSeparator.value)
  saveTextAs(serializeBackup(backup), `easytable-backup-${Date.now()}.json`, 'json')
}

function saveTextAs(text: string, defaultName: string, kind: string) {
  const svc = (window as any).services
  try {
    if (svc?.pickSavePath && svc?.writeTextFile) {
      const filePath = svc.pickSavePath({ defaultPath: defaultName })
      if (!filePath) return
      const saved = svc.writeTextFile(filePath, text)
      ElMessage.success(`已保存：${saved}`)
      return
    }
  } catch (e) {
    console.error(e)
  }
  // 浏览器降级
  const ext = kind === 'json' ? 'application/json' : kind === 'csv' ? 'text/csv' : 'text/plain'
  const blob = new Blob([text], { type: `${ext};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = defaultName
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('已开始下载')
}

function openImport() {
  showImport.value = true
}

async function importJsonBackup() {
  const svc = (window as any).services
  let text = ''
  try {
    if (svc?.pickOpenPath && svc?.readFile) {
      const picked = svc.pickOpenPath({
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      const file = picked?.[0]
      if (!file) return
      text = svc.readFile(file)
    }
  } catch (e) {
    ElMessage.error('读取文件失败')
    return
  }
  if (!text) {
    ElMessage.warning('未选择文件')
    return
  }
  let backup: BackupFile
  try {
    backup = parseBackup(text)
  } catch (e: any) {
    ElMessage.error(e?.message || '解析备份失败')
    return
  }
  // 备份可能含数百表/数千行，bulk 化后仍可能耗时，整段加 loading
  const loading = ElLoading.service({ lock: true, text: '正在导入备份…' })
  try {
    await new Promise<void>((r) => setTimeout(r, 0)) // 让 loading 渲染出来
    try {
      await ElMessageBox.confirm(
        `备份含 ${backup.tables.length} 张表。选择「覆盖全部」将替换现有所有表；「合并」按表 id 覆盖/追加。`,
        '导入 JSON 备份',
        {
          distinguishCancelAndClose: true,
          confirmButtonText: '覆盖全部',
          cancelButtonText: '合并',
          type: 'warning'
        }
      )
      const n = await importBackupTables(backup.tables, 'replace-all')
      ElMessage.success(`已覆盖导入 ${n} 张表`)
    } catch (action) {
      if (action === 'cancel') {
        const n = await importBackupTables(backup.tables, 'merge')
        ElMessage.success(`已合并导入 ${n} 张表`)
      }
    }
  } finally {
    loading.close()
  }
}

function onSaveSchema(schema: TableSchema) {
  // 字段被删掉后，它的列宽记录一并清掉
  updateTableSchema(pruneColumnWidths(schema))
  // 清掉引用了已删除字段的条件（系统时间列不受影响）
  const validIds = new Set(schema.fields.map((f) => f.id))
  filters.value = filters.value.filter(
    (c) => c.fieldId.startsWith('__') || validIds.has(c.fieldId)
  )
  ElMessage.success('字段已更新')
}

/**
 * 保存 schema 后的数据迁移队列。改类型转换、新字段回填默认值都会整表写入，
 * 并发跑会互相覆盖（各自拿快照 → 后写的把先写的抹掉），所以串起来执行。
 */
let migrationChain: Promise<void> = Promise.resolve()
function queueMigration(task: () => Promise<void>) {
  migrationChain = migrationChain.then(task).catch((e) => console.error(e))
}

/** 字段改了类型：按新类型转换已有行的值（FieldManagerDialog 已确认过） */
function onCoerce(fieldIds: string[]) {
  const table = activeTable.value
  if (!table || !fieldIds.length) return
  queueMigration(async () => {
    const result = coerceRowsToFields(activeRows.value, table.fields, fieldIds)
    if (!result) return
    await replaceRows(table.id, result.rows)
    ElMessage.success(`已按新类型转换 ${result.changedRows} 条记录`)
  })
}

/** 新增字段带默认值时：把默认值回填到已有记录（FieldManagerDialog 已确认过） */
function onBackfill(fieldIds: string[]) {
  const table = activeTable.value
  if (!table || !fieldIds.length) return
  queueMigration(async () => {
    let list = activeRows.value
    let n = 0
    for (const fid of fieldIds) {
      const f = table.fields.find((x) => x.id === fid)
      if (!f) continue
      const next = backfillField(list, f)
      if (!next) continue
      list = next.rows
      n += next.changedRows
    }
    if (!n) return
    await backfillRows(table.id, list)
    ElMessage.success(`已回填 ${n} 条记录`)
  })
}

async function onCreateTable() {
  try {
    const { value } = await ElMessageBox.prompt('新表名称', '新建表格', {
      inputValue: '新表格',
      confirmButtonText: '创建',
      cancelButtonText: '取消'
    })
    addTable((value || '新表格').trim() || '新表格')
    showFieldMgr.value = true
  } catch {
    // 取消
  }
}

async function onRemoveTable() {
  const t = activeTable.value
  if (!t) return
  try {
    await ElMessageBox.confirm(`删除表格「${t.name}」及其全部记录？`, '删除表格', {
      type: 'warning'
    })
    removeTable(t.id)
    resetSelection()
    ElMessage.success('已删除表格')
  } catch {
    // 取消
  }
}

/**
 * 清空当前表的所有记录，保留表定义（表名/字段不动）。
 * 两段确认 + 全屏 loading；走 bulkDocs，单次 IPC 提交整张表清空。
 */
async function onClearTable() {
  const t = activeTable.value
  if (!t) return
  const count = activeRows.value.length
  if (!count) {
    ElMessage.info('当前表已经是空的')
    return
  }
  // 第一段：核心警示，提示先导出 JSON
  try {
    await ElMessageBox.confirm(
      `将清空「${t.name}」的 ${count} 条记录，仅保留表定义。此操作不可撤销。\n\n建议先在「导出」→「JSON 备份」保存一份。`,
      '清空当前表',
      {
        type: 'warning',
        confirmButtonText: '已备份，继续',
        cancelButtonText: '取消',
        distinguishCancelAndClose: true,
        closeOnClickModal: false
      }
    )
  } catch {
    return
  }
  // 第二段：兜底二次确认，避免一不留神连点两次走完
  try {
    await ElMessageBox.confirm(
      `最后确认：清空「${t.name}」共 ${count} 条记录？`,
      '再次确认',
      {
        type: 'warning',
        confirmButtonText: '清空',
        cancelButtonText: '取消'
      }
    )
  } catch {
    return
  }
  const loading = ElLoading.service({ lock: true, text: `正在清空表「${t.name}」…` })
  await new Promise<void>((r) => setTimeout(r, 0)) // 让 loading 先渲染
  try {
    const n = await clearTableRows(t.id)
    resetSelection()
    ElMessage.success(`已清空表「${t.name}」，删除 ${n} 条记录`)
  } catch (e: any) {
    ElMessage.error(e?.message || '清空失败')
  } finally {
    loading.close()
  }
}

function onImportCommand(cmd: string | number | object) {
  const c = String(cmd)
  if (c === 'text') openImport()
  else if (c === 'json') importJsonBackup()
}

function onExportCommand(cmd: string | number | object) {
  const c = String(cmd)
  if (c === 'copy') void copySelectedAsTsv(true)
  else if (c === 'tsv') exportTsvFile()
  else if (c === 'csv') exportCsvFile()
  else if (c === 'json') exportJson()
}

function onMoreCommand(cmd: string | number | object) {
  const c = String(cmd)
  if (c === 'fields') showFieldMgr.value = true
  else if (c === 'batch') openBatchEdit()
  else if (c === 'rowheight-fixed') setRowHeightMode('fixed')
  else if (c === 'rowheight-auto') setRowHeightMode('auto')
  else if (c === 'colwidth-reset') resetColumnWidths()
  else if (c === 'clear') onClearTable()
  else if (c === 'delete') onRemoveTable()
}

const filterActive = computed(() => filters.value.length > 0)

const hasFilterFields = computed(() => fields.value.length > 0)

function clearFilter() {
  filters.value = []
}

/** 生成条件 key */
let condSeq = 0
function newCondKey(): string {
  condSeq += 1
  return `c_${Date.now().toString(36)}_${condSeq}`
}

function addFilter() {
  const f = filterableFields(fields.value)[0]
  if (!f) return
  const ops = opsForField(f)
  filters.value.push({
    key: newCondKey(),
    fieldId: f.id,
    op: ops[0]?.op ?? 'empty',
    value: ''
  })
}

/** 条件当前字段的操作符选项（字段不存在时给空列表） */
function condOps(fieldId: string) {
  const f = filterableFields(fields.value).find((x) => x.id === fieldId)
  return f ? opsForField(f) : []
}

function onFilterFieldChange(cond: FilterCond) {
  const ops = condOps(cond.fieldId)
  // 字段切换后 op 可能不适用：重置为该字段第一个操作符并清值
  if (!ops.some((o) => o.op === cond.op)) {
    cond.op = ops[0]?.op ?? 'empty'
  }
  if (cond.op !== 'eq' && cond.op !== 'contains') cond.value = ''
}

function onFilterOpChange(cond: FilterCond) {
  if (cond.op !== 'eq' && cond.op !== 'contains') cond.value = ''
}

function removeFilter(key: string) {
  filters.value = filters.value.filter((c) => c.key !== key)
}

/** 快捷时间条件：已有同字段同 op 条件则移除（再次点击=取消），否则追加 */
function toggleQuickCond(fieldId: string, op: FilterOp) {
  const idx = filters.value.findIndex((c) => c.fieldId === fieldId && c.op === op)
  if (idx >= 0) {
    filters.value.splice(idx, 1)
    return
  }
  filters.value.push({ key: newCondKey(), fieldId, op, value: '' })
}

function quickCondActive(fieldId: string, op: FilterOp): boolean {
  return filters.value.some((c) => c.fieldId === fieldId && c.op === op)
}

/** 各字段在已有行里出现过的取值（扫一遍全表缓存住，供筛选候选项用） */
const rowValuesByField = computed(() => {
  const map = new Map<string, string[]>()
  for (const f of fields.value) {
    if (hasOptions(f)) map.set(f.id, collectFieldOptions(activeRows.value, f))
  }
  return map
})

/** eq 条件的候选项：字段选项 ∪ 已有数据里出现过的值 */
function condOptions(fieldId: string): string[] {
  const f = fields.value.find((x) => x.id === fieldId)
  if (!f || !hasOptions(f)) return []
  const merged = new Set(f.options)
  for (const v of rowValuesByField.value.get(f.id) ?? []) merged.add(v)
  return [...merged]
}

const quickConds = computed(() => [
  { fieldId: CREATED_AT_FIELD_ID, op: 'thisWeek' as FilterOp, label: '本周创建' },
  { fieldId: CREATED_AT_FIELD_ID, op: 'thisMonth' as FilterOp, label: '本月创建' },
  { fieldId: UPDATED_AT_FIELD_ID, op: 'today' as FilterOp, label: '今天更新' },
  { fieldId: UPDATED_AT_FIELD_ID, op: 'thisWeek' as FilterOp, label: '本周更新' }
])

/**
 * 清空勾选：必须连 el-table 内部持有的勾选状态一起清（选择列开了 reserve-selection，
 * 只把 selectedIds 置空的话，勾选框还留着，之后新勾一行会把残留记录一起算进已选）。
 */
function resetSelection() {
  gridRef.value?.clearSelection()
  selectedIds.value = new Set()
}

// 预填：启动 payload 像 pm 号时打开新建
watch(
  () => activeTable.value?.id,
  () => {
    resetSelection()
    filters.value = []
    filterOpen.value = false
    sortFieldId.value = null
  }
)

const enterPayload = ref('')

function applyEnterAction(code?: string, payload?: unknown) {
  const text = typeof payload === 'string' ? payload.trim() : ''
  // 记一笔：直接打开新增
  if (code === 'new-row') {
    enterPayload.value = text && text.length <= 40 ? text : ''
    openCreate()
    return
  }
  // 主入口：仅当参数像记录内容时预填
  const looksLikeData =
    !!text &&
    text.length <= 40 &&
    !['表格', '记录', '简单记录', 'easytable', '记一笔'].includes(text)
  enterPayload.value = looksLikeData ? text : ''
  if (looksLikeData) openCreate()
}

defineExpose({ applyEnterAction })
</script>

<template>
  <div class="page">
    <main class="main">
      <div v-if="!activeTable" class="empty-page">
        <p class="empty-title">还没有表格</p>
        <p class="empty-desc">新建一张表，然后在「表设置」里定义字段</p>
        <el-button type="primary" @click="onCreateTable">+ 新建表</el-button>
      </div>

      <template v-else>
      <header class="toolbar">
        <el-button size="small" type="primary" plain @click="onCreateTable">+ 新建表</el-button>
        <el-select
          :model-value="activeTable?.id ?? ''"
          placeholder="选择表格"
          size="small"
          class="table-select"
          @update:model-value="(v: string | number) => setActiveTable(String(v))"
        >
          <el-option v-for="t in tables" :key="t.id" :label="t.name" :value="t.id" />
        </el-select>
        <el-input
          v-model="keyword"
          placeholder="搜索当前表…"
          clearable
          class="search"
          size="small"
        />
        <div class="spacer" />
        <el-button size="small" type="primary" @click="openCreate">+ 新增</el-button>
        <el-popover
          v-if="hasFilterFields"
          placement="bottom-end"
          :width="360"
          trigger="click"
          popper-class="filter-pop"
          v-model:visible="filterOpen"
          :hide-after="0"
        >
          <template #reference>
            <el-button size="small" text :type="filterActive ? 'primary' : 'default'">
              筛选{{ filterActive ? ` · ${filters.length}` : '' }}
            </el-button>
          </template>
          <!-- teleported=false：下拉留在弹层内，避免点选项被当成「点外部」关掉筛选 -->
          <div class="filter-panel" @click.stop>
            <div class="quick-conds">
              <el-button
                v-for="qc in quickConds"
                :key="qc.fieldId + qc.op"
                size="small"
                :type="quickCondActive(qc.fieldId, qc.op) ? 'primary' : 'default'"
                plain
                class="quick-chip"
                @click="toggleQuickCond(qc.fieldId, qc.op)"
              >
                {{ qc.label }}
              </el-button>
            </div>
            <div v-for="cond in filters" :key="cond.key" class="cond-row">
              <el-select
                :model-value="cond.fieldId"
                size="small"
                class="cond-field"
                :teleported="false"
                @update:model-value="(v: string) => { cond.fieldId = v; onFilterFieldChange(cond) }"
              >
                <el-option
                  v-for="f in filterableFields(fields)"
                  :key="f.id"
                  :label="f.name"
                  :value="f.id"
                />
              </el-select>
              <el-select
                :model-value="cond.op"
                size="small"
                class="cond-op"
                :teleported="false"
                @update:model-value="(v: FilterOp) => { cond.op = v; onFilterOpChange(cond) }"
              >
                <el-option v-for="o in condOps(cond.fieldId)" :key="o.op" :label="o.label" :value="o.op" />
              </el-select>
              <el-select
                v-if="cond.op === 'eq'"
                :model-value="cond.value"
                size="small"
                class="cond-value"
                :teleported="false"
                placeholder="选择"
                @update:model-value="(v: string) => { cond.value = v }"
              >
                <el-option v-for="opt in condOptions(cond.fieldId)" :key="opt" :label="opt" :value="opt" />
              </el-select>
              <el-input
                v-else-if="cond.op === 'contains'"
                :model-value="cond.value"
                size="small"
                class="cond-value"
                placeholder="关键词"
                clearable
                @update:model-value="(v: string) => { cond.value = v }"
              />
              <el-button size="small" text type="danger" class="cond-del" @click="removeFilter(cond.key)">
                ×
              </el-button>
            </div>
            <el-button size="small" text type="primary" @click="addFilter">+ 添加条件</el-button>
            <div class="filter-actions">
              <el-button v-if="filterActive" size="small" text type="primary" @click="clearFilter">
                清除全部
              </el-button>
              <el-button size="small" text style="margin-left: auto" @click="filterOpen = false">
                收起
              </el-button>
            </div>
          </div>
        </el-popover>
        <el-dropdown trigger="click" @command="onImportCommand">
          <el-button size="small" text>
            导入<span class="caret">▾</span>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="text">CSV / TSV 文本…</el-dropdown-item>
              <el-dropdown-item command="json">JSON 备份…</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-dropdown trigger="click" @command="onExportCommand">
          <el-button size="small" text>
            导出<span class="caret">▾</span>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="copy">复制到 Excel</el-dropdown-item>
              <el-dropdown-item command="tsv" divided>TSV 文件</el-dropdown-item>
              <el-dropdown-item command="csv">CSV 文件</el-dropdown-item>
              <el-dropdown-item command="json">JSON 备份</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-dropdown trigger="click" @command="onMoreCommand">
          <el-button size="small" text class="more-btn">⋯</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="fields">表设置（字段 / 表名）</el-dropdown-item>
              <el-dropdown-item command="batch">批量修改字段…</el-dropdown-item>
              <el-dropdown-item command="rowheight-fixed">
                <span class="rowheight-item">
                  {{ rowHeightMode === 'fixed' ? '✓' : '' }} 固定行高（超出省略）
                </span>
              </el-dropdown-item>
              <el-dropdown-item command="rowheight-auto">
                <span class="rowheight-item">
                  {{ rowHeightMode === 'auto' ? '✓' : '' }} 自适应行高（随内容撑高）
                </span>
              </el-dropdown-item>
              <el-dropdown-item command="colwidth-reset">列宽重置为自动</el-dropdown-item>
              <el-dropdown-item command="clear" divided>清空当前表（仅记录）</el-dropdown-item>
              <el-dropdown-item command="delete" divided>删除当前表</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </header>

      <div v-if="selectedIds.size" class="select-bar">
        <span class="select-count">已选 {{ selectedIds.size }} 条</span>
        <el-button link type="primary" size="small" @click="openBatchEdit">批量修改</el-button>
        <el-button link type="primary" size="small" @click="copySelectedAsTsv(true)">
          复制到 Excel
        </el-button>
        <el-button link type="danger" size="small" @click="onDeleteSelected">删除</el-button>
        <el-button link size="small" @click="resetSelection">取消选择</el-button>
      </div>

      <div class="grid-wrap">
        <el-table
          ref="gridRef"
          :data="pageRows"
          height="100%"
          size="small"
          border
          row-key="id"
          :class="rowHeightMode === 'auto' ? 'row-height-auto' : 'row-height-fixed'"
          @selection-change="(rows: Row[]) => { selectedIds = new Set(rows.map((r) => r.id)) }"
          @row-dblclick="(row: Row) => openEdit(row)"
          @sort-change="onSortChange"
          @header-dragend="onHeaderDragend"
        >
          <el-table-column type="selection" width="40" align="center" :reserve-selection="true" />
          <el-table-column label="操作" width="110" align="center" fixed="left">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click.stop="copyRow(row)">复制</el-button>
              <el-button link type="primary" size="small" @click.stop="openEdit(row)">编辑</el-button>
            </template>
          </el-table-column>
          <el-table-column
            v-for="f in displayFields"
            :key="f.id"
            :prop="f.id"
            :label="f.name"
            :width="manualWidth(f.id)"
            :min-width="manualWidth(f.id) ? undefined : autoWidths[f.id]"
            align="center"
            header-align="center"
            sortable="custom"
            show-overflow-tooltip
            :tooltip-formatter="colTooltip"
            :sort-orders="['ascending', 'descending', null]"
          >
            <template #header>
              <span class="col-head">
                <span>{{ f.name }}</span>
                <span v-if="f.required" class="req-star">*</span>
                <el-tooltip v-if="f.unique" content="唯一：同表内不允许重复" placement="top">
                  <span class="uniq-badge">唯</span>
                </el-tooltip>
              </span>
            </template>
            <template #default="{ row }">
              <template v-if="f.type === 'multi_select' || f.type === 'list'">
                <el-tag v-for="tag in multiTags(f, row)" :key="tag" size="small" class="tag">
                  {{ tag }}
                </el-tag>
              </template>
              <a
                v-else-if="f.type === 'url' && cellText(f, row)"
                href="javascript:void(0)"
                class="link"
                @click.stop="openUrl(String(row.values[f.id] ?? ''))"
              >
                {{ cellText(f, row) }}
              </a>
              <span v-else-if="f.type === 'checkbox'">
                {{ row.values[f.id] ? '✓' : '' }}
              </span>
              <span v-else>{{ cellText(f, row) }}</span>
            </template>
          </el-table-column>
          <template #empty>
            <el-empty description="暂无记录，点击「新增」开始" :image-size="80" />
          </template>
        </el-table>
      </div>

      <footer class="status">
        <span>共 {{ filteredRows.length }} 条</span>
        <template v-if="selectedIds.size"> · 已选 {{ selectedIds.size }}</template>
        <template v-if="keyword"> · 搜索「{{ keyword }}」</template>
        <div class="pager">
          <span class="pager-size">
            <el-select v-model="pageSize" size="small" style="width: 88px">
              <el-option :value="20" label="20 条/页" />
              <el-option :value="50" label="50 条/页" />
              <el-option :value="100" label="100 条/页" />
              <el-option :value="200" label="200 条/页" />
            </el-select>
          </span>
          <el-button link size="small" :disabled="page <= 1" @click="page -= 1">上一页</el-button>
          <span class="pager-info">{{ page }} / {{ pageCount }}</span>
          <el-button link size="small" :disabled="page >= pageCount" @click="page += 1">
            下一页
          </el-button>
        </div>
      </footer>
      </template>
    </main>

    <RowFormDrawer
      v-model:visible="showRowForm"
      :table="activeTable ?? { id: '', name: '', fields: [], createdAt: 0, updatedAt: 0 }"
      :row="editingRow"
      :rows="activeRows"
      :prefill-text="enterPayload"
      @save="onSaveRow"
    />
    <FieldManagerDialog
      v-model:visible="showFieldMgr"
      :table="activeTable ?? { id: '', name: '', fields: [], createdAt: 0, updatedAt: 0 }"
      :row-count="activeRows.length"
      :rows="activeRows"
      @save="onSaveSchema"
      @backfill="onBackfill"
      @coerce="onCoerce"
    />
    <ImportDialog
      v-model:visible="showImport"
      :table="activeTable ?? { id: '', name: '', fields: [], createdAt: 0, updatedAt: 0 }"
      :multi-separator="multiSeparator"
    />
    <BatchEditDialog
      v-model:visible="showBatchEdit"
      :table="activeTable ?? { id: '', name: '', fields: [], createdAt: 0, updatedAt: 0 }"
      :targets="batchTargetRows"
      :from-selection="selectedIds.size > 0"
      :rows="activeRows"
      @apply="onBatchApply"
    />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  height: 100vh;
  min-height: 520px;
  overflow: hidden;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
}
.side {
  width: 148px;
  border-right: 1px solid var(--el-border-color);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: auto;
}
.side-title {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}
.table-item {
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.table-item:hover {
  background: var(--el-fill-color-light);
}
.table-item.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 500;
}
.table-item .name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.table-item .cnt {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.empty-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--el-text-color-secondary);
}
.empty-title {
  margin: 0;
  font-size: 16px;
  color: var(--el-text-color-primary);
}
.empty-desc {
  margin: 0 0 8px;
  font-size: 13px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--el-border-color);
}
.table-select {
  width: 140px;
  margin-right: 4px;
}
.search {
  width: 220px;
  max-width: 42%;
}
.spacer {
  flex: 1;
}
.caret {
  font-size: 10px;
  margin-left: 2px;
  opacity: 0.65;
}
.more-btn {
  min-width: 32px;
  letter-spacing: 1px;
  font-weight: 600;
}
.rowheight-item {
  display: inline-block;
  min-width: 130px;
  text-align: left;
  white-space: nowrap;
}
.filter-panel {
  display: flex;
  flex-direction: column;
}
.quick-conds {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.quick-chip {
  margin: 0 !important;
}
.cond-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
}
.cond-field {
  width: 108px;
  flex-shrink: 0;
}
.cond-op {
  width: 92px;
  flex-shrink: 0;
}
.cond-value {
  flex: 1;
  min-width: 0;
}
.cond-del {
  padding: 4px !important;
}
.filter-actions {
  display: flex;
  align-items: center;
  margin-top: 4px;
}
.select-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-color-primary-light-9);
  font-size: 12px;
}
.select-count {
  color: var(--el-color-primary);
  margin-right: 8px;
}
.grid-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.grid-wrap :deep(.el-table) {
  /* 放手让 el-table 自己滚：撑满 grid-wrap，body-wrapper 触发垂直滚动 */
  flex: 1;
  min-height: 0;
  width: 100%;
}
/* 行高样式开关：fixed=固定行高（单行省略），auto=随内容撑高 */
.grid-wrap :deep(.el-table.row-height-fixed .el-table__cell) {
  padding: 5px 0;
}
.grid-wrap :deep(.el-table.row-height-fixed .cell) {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.grid-wrap :deep(.el-table.row-height-fixed .tag) {
  margin: 0 4px 0 0;
  white-space: nowrap;
}
.grid-wrap :deep(.el-table.row-height-auto .cell) {
  white-space: normal;
  word-break: break-all;
}
.grid {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.grid th,
.grid td {
  border-bottom: 1px solid var(--el-border-color-lighter);
  padding: 8px 10px;
  text-align: left;
  vertical-align: top;
}
.grid th.col-field,
.grid td.cell {
  min-width: 110px;
}
.grid thead th {
  position: sticky;
  top: 0;
  background: var(--el-bg-color);
  z-index: 1;
  user-select: none;
  cursor: pointer;
  color: var(--el-text-color-secondary);
  font-weight: 500;
  white-space: nowrap;
}
.grid tbody tr:hover {
  background: var(--el-fill-color-lighter);
}
.grid tbody tr.selected {
  background: var(--el-color-primary-light-9);
}
.col-check {
  width: 36px;
}
.col-act {
  width: 96px;
  white-space: nowrap;
  cursor: default !important;
}
.th-label {
  margin-right: 4px;
}
.sort-caret {
  color: var(--el-color-primary);
}
.cell {
  max-width: 280px;
  word-break: break-all;
}
.tag {
  margin: 0 4px 4px 0;
}
.link {
  color: var(--el-color-primary);
  text-decoration: none;
}
.col-head {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.req-star {
  color: var(--el-color-danger);
  font-weight: 600;
}
.uniq-badge {
  font-size: 10px;
  line-height: 1;
  padding: 1px 3px;
  border-radius: 3px;
  color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
}
.link:hover {
  text-decoration: underline;
}
.empty {
  text-align: center;
  color: var(--el-text-color-secondary);
  padding: 28px !important;
}
.status {
  border-top: 1px solid var(--el-border-color);
  padding: 6px 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  display: flex;
  gap: 4px;
  align-items: center;
  flex-wrap: wrap;
}
.status .tip {
  margin-left: auto;
}
.pager {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
}
.pager-info {
  min-width: 48px;
  text-align: center;
}
</style>
