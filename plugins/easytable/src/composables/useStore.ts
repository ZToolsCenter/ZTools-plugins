import { ref, computed } from 'vue'
import type { AppMeta, Row, TableSchema } from '../types/table'
import { createEmptyTable } from '../templates/worklog'
import { generateId } from '../utils/id'

type Services = {
  loadMeta: () => AppMeta
  saveMeta: (meta: AppMeta) => AppMeta
  listRows: (tableId: string) => Row[]
  putRow: (row: Row) => Row
  deleteRow: (tableId: string, rowId: string) => boolean
  /** 兼容：bulk 后内部走 bulkDocs 异步，实际返回 Promise<number> */
  replaceTableRows: (tableId: string, rows: Row[]) => number | Promise<number>
  /** bulkDocs 异步路径：单次 IPC 提交整表 */
  replaceTableRowsBulk?: (tableId: string, rows: Row[]) => Promise<number> | number
  /** bulk 后异步返回 */
  deleteTableRows: (tableId: string) => boolean | Promise<unknown>
  generateId: (prefix?: string) => string
  writeTextFile: (filePath: string | undefined, text: string) => string
  readFile: (filePath: string) => string
  pickSavePath: (options?: unknown) => string | undefined
  pickOpenPath: (options?: unknown) => string[] | undefined
}

function services(): Services | null {
  return (window as any).services ?? null
}

const meta = ref<AppMeta>({
  version: 1,
  tables: [],
  activeTableId: '',
  multiSeparator: '、'
})
const rowsByTable = ref<Record<string, Row[]>>({})
const loaded = ref(false)

function persistMeta() {
  services()?.saveMeta(meta.value)
}

function loadAllRows() {
  const map: Record<string, Row[]> = {}
  for (const t of meta.value.tables) {
    map[t.id] = services()?.listRows(t.id) ?? []
  }
  rowsByTable.value = map
}

export function useStore() {
  const tables = computed(() => meta.value.tables)
  const activeTable = computed(
    () => meta.value.tables.find((t) => t.id === meta.value.activeTableId) ?? meta.value.tables[0] ?? null
  )
  const activeRows = computed(() =>
    activeTable.value ? rowsByTable.value[activeTable.value.id] ?? [] : []
  )
  const multiSeparator = computed(() => meta.value.multiSeparator || '、')
  const rowHeightMode = computed<'fixed' | 'auto'>(() => meta.value.rowHeightMode ?? 'fixed')

  function ensureBootstrapped() {
    if (loaded.value) return
    // 空启动：不预置任何表
    if (!services()) {
      meta.value = { version: 1, tables: [], activeTableId: '', multiSeparator: '、' }
      rowsByTable.value = {}
      loaded.value = true
      return
    }
    meta.value = services()!.loadMeta()
    if (
      meta.value.tables.length &&
      (!meta.value.activeTableId ||
        !meta.value.tables.some((t) => t.id === meta.value.activeTableId))
    ) {
      meta.value.activeTableId = meta.value.tables[0].id
      persistMeta()
    }
    loadAllRows()
    loaded.value = true
  }

  function setActiveTable(id: string) {
    if (meta.value.activeTableId === id) return
    meta.value.activeTableId = id
    persistMeta()
  }

  function addTable(name: string) {
    const t = createEmptyTable(name)
    if (name) t.name = name
    meta.value.tables.push(t)
    meta.value.activeTableId = t.id
    rowsByTable.value[t.id] = []
    persistMeta()
    return t
  }

  function renameTable(id: string, name: string) {
    const t = meta.value.tables.find((x) => x.id === id)
    if (!t) return
    t.name = name.trim() || t.name
    t.updatedAt = Date.now()
    persistMeta()
  }

  function updateTableSchema(schema: TableSchema) {
    const idx = meta.value.tables.findIndex((t) => t.id === schema.id)
    if (idx < 0) return
    meta.value.tables[idx] = { ...schema, updatedAt: Date.now() }
    persistMeta()
  }

  function removeTable(id: string) {
    meta.value.tables = meta.value.tables.filter((t) => t.id !== id)
    services()?.deleteTableRows(id)
    delete rowsByTable.value[id]
    if (meta.value.activeTableId === id) {
      meta.value.activeTableId = meta.value.tables[0]?.id ?? ''
    }
    persistMeta()
  }

  function setMultiSeparator(sep: string) {
    meta.value.multiSeparator = sep || '、'
    persistMeta()
  }

  function setQuickTableId(id: string) {
    meta.value.quickTableId = id || ''
    persistMeta()
  }

  function setRowHeightMode(mode: 'fixed' | 'auto') {
    meta.value.rowHeightMode = mode
    persistMeta()
  }

  /** 新增字段回填默认值：更新内存行 + bulkDocs 一次持久化整表 */
  async function backfillRows(tableId: string, rows: Row[]): Promise<void> {
    rowsByTable.value = { ...rowsByTable.value, [tableId]: rows }
    await replaceRows(tableId, rows)
  }

  function upsertRow(row: Row) {
    const list = rowsByTable.value[row.tableId] ? [...rowsByTable.value[row.tableId]] : []
    const idx = list.findIndex((r) => r.id === row.id)
    if (idx >= 0) list[idx] = row
    else list.push(row)
    rowsByTable.value = { ...rowsByTable.value, [row.tableId]: list }
    services()?.putRow(row)
  }

  function deleteRow(tableId: string, rowId: string) {
    const list = (rowsByTable.value[tableId] ?? []).filter((r) => r.id !== rowId)
    rowsByTable.value = { ...rowsByTable.value, [tableId]: list }
    services()?.deleteRow(tableId, rowId)
  }

  function deleteRows(tableId: string, rowIds: string[]) {
    const set = new Set(rowIds)
    const list = (rowsByTable.value[tableId] ?? []).filter((r) => !set.has(r.id))
    rowsByTable.value = { ...rowsByTable.value, [tableId]: list }
    for (const id of rowIds) services()?.deleteRow(tableId, id)
  }

  /**
   * 整表替换：走 preload 的 bulkDocs 路径（420 行 ~2 IPC）。
   * 返回 Promise<number>；UI 端要 await 才能看到持久化完成。
   */
  async function replaceRows(tableId: string, rows: Row[]): Promise<number> {
    rowsByTable.value = { ...rowsByTable.value, [tableId]: rows }
    const svc = services()
    if (!svc) return rows.length
    const list = Array.isArray(rows) ? rows : []
    try {
      if (typeof svc.replaceTableRowsBulk === 'function') {
        return await svc.replaceTableRowsBulk(tableId, list)
      }
      return (await Promise.resolve(svc.replaceTableRows(tableId, list))) as number
    } catch {
      return list.length
    }
  }

  /**
   * 清空指定表的所有记录（保留表定义、字段、表名）。
   * 走 preload bulkDocs 整表一次，IPC ≈ 2。
   * 返回被清掉的条数，UI 端用于统计提示。
   */
  async function clearTableRows(tableId: string): Promise<number> {
    const existed = rowsByTable.value[tableId]?.length ?? 0
    // 内存层先清，给 UI 立刻反馈
    rowsByTable.value = { ...rowsByTable.value, [tableId]: [] }
    const n = await replaceRows(tableId, [])
    return Math.max(existed, n)
  }

  function createRow(tableId: string, values: Row['values']): Row {
    const now = Date.now()
    const row: Row = {
      id: generateId('row'),
      tableId,
      values,
      createdAt: now,
      updatedAt: now
    }
    upsertRow(row)
    return row
  }

  function saveRow(id: string, tableId: string, values: Row['values']) {
    const old = (rowsByTable.value[tableId] ?? []).find((r) => r.id === id)
    const row: Row = {
      id,
      tableId,
      values,
      createdAt: old?.createdAt ?? Date.now(),
      updatedAt: Date.now()
    }
    upsertRow(row)
    return row
  }

  /** 整表导入备份（覆盖该表 id 对应数据，不存在则新建表） */
  async function importBackupTables(
    incoming: Array<{ schema: TableSchema; rows: Row[] }>,
    mode: 'merge' | 'replace-all'
  ): Promise<number> {
    if (mode === 'replace-all') {
      const tables: TableSchema[] = []
      const map: Record<string, Row[]> = {}
      for (const t of incoming) {
        tables.push(t.schema)
        map[t.schema.id] = t.rows
      }
      // 清掉旧表数据
      for (const old of meta.value.tables) {
        services()?.deleteTableRows(old.id)
      }
      meta.value.tables = tables
      meta.value.activeTableId = tables[0]?.id ?? ''
      for (const t of meta.value.tables) {
        map[t.id] = map[t.id] ?? []
        await replaceRows(t.id, map[t.id])
      }
      rowsByTable.value = map
      persistMeta()
      return tables.length
    }
    // merge：同 id 覆盖表定义与行，新 id 追加
    let touched = 0
    for (const t of incoming) {
      const idx = meta.value.tables.findIndex((x) => x.id === t.schema.id)
      if (idx >= 0) meta.value.tables[idx] = t.schema
      else meta.value.tables.push(t.schema)
      await replaceRows(t.schema.id, t.rows)
      touched += 1
    }
    persistMeta()
    return touched
  }

function reloadRows() {
  loadAllRows()
}

function collectAllRows(): Record<string, Row[]> {
  const map: Record<string, Row[]> = {}
  for (const t of meta.value.tables) {
    map[t.id] = rowsByTable.value[t.id] ?? []
  }
  return map
}

  return {
    meta,
    loaded,
    tables,
    activeTable,
    activeRows,
    multiSeparator,
    rowHeightMode,
    ensureBootstrapped,
    setActiveTable,
    addTable,
    renameTable,
    updateTableSchema,
    removeTable,
    setMultiSeparator,
    setQuickTableId,
    setRowHeightMode,
    backfillRows,
    createRow,
    saveRow,
    deleteRow,
    deleteRows,
    replaceRows,
    clearTableRows,
    upsertRow,
    importBackupTables,
    collectAllRows,
    reloadRows
  }
}
