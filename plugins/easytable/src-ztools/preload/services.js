const fs = require('node:fs')
const path = require('node:path')

const META_KEY = 'easytable_meta'
const ROWS_KEY = 'easytable_rows'
const ROW_PREFIX = 'row:'

function safeParse(data, fallback) {
  try {
    if (data == null) return fallback
    const raw = typeof data === 'string' ? JSON.parse(data) : data
    return raw == null ? fallback : raw
  } catch (e) {
    return fallback
  }
}

function generateId(prefix) {
  return (
    (prefix || 'id') +
    '_' +
    Date.now().toString(36) +
    '_' +
    Math.random().toString(36).slice(2, 8)
  )
}

function defaultMeta() {
  return {
    version: 1,
    tables: [],
    activeTableId: '',
    multiSeparator: '、'
  }
}

/** 行数据：优先 ztools.db（按 _id 前缀），失败回退 dbStorage 整包。 */
function readRowsFromDb(tableId) {
  const prefix = ROW_PREFIX + tableId + ':'
  const docs = window.ztools.db.allDocs(prefix) || []
  const rows = []
  for (const doc of docs) {
    if (!doc) continue
    const id = String(doc.rowId || doc.id || (doc._id || '').split(':').pop() || '')
    if (!id) continue
    rows.push({
      id,
      tableId,
      values: doc.values && typeof doc.values === 'object' ? doc.values : {},
      createdAt: doc.createdAt || 0,
      updatedAt: doc.updatedAt || 0
    })
  }
  rows.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
  return rows
}

function writeRowToDb(row) {
  const _id = ROW_PREFIX + row.tableId + ':' + row.id
  let doc = {
    _id,
    rowId: row.id,
    tableId: row.tableId,
    values: row.values,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
  try {
    const existing = window.ztools.db.get(_id)
    if (existing && existing._rev) doc._rev = existing._rev
  } catch (e) {}
  window.ztools.db.put(doc)
}

function removeRowFromDb(tableId, rowId) {
  const _id = ROW_PREFIX + tableId + ':' + rowId
  try {
    const existing = window.ztools.db.get(_id)
    if (existing) window.ztools.db.remove(existing)
  } catch (e) {}
}

function readRowsFallback() {
  const data = window.ztools.dbStorage.getItem(ROWS_KEY)
  const map = safeParse(data, {})
  return map && typeof map === 'object' ? map : {}
}

function writeRowsFallback(map) {
  window.ztools.dbStorage.setItem(ROWS_KEY, JSON.stringify(map || {}))
}

function readRows(tableId) {
  // 合并 ztools.db 与 dbStorage 回退副本，避免单写失败/进程被杀导致丢数
  const fromDb = (() => {
    try {
      if (window.ztools.db && typeof window.ztools.db.allDocs === 'function') {
        return readRowsFromDb(tableId) || []
      }
    } catch (e) {}
    return []
  })()
  const map = readRowsFallback()
  const fromStorage = Array.isArray(map[tableId]) ? map[tableId] : []
  const byId = new Map()
  for (const r of fromStorage) {
    if (r && r.id) byId.set(String(r.id), r)
  }
  for (const r of fromDb) {
    if (r && r.id) byId.set(String(r.id), r)
  }
  return [...byId.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
}

function writeRow(row) {
  // 单行：先写 dbStorage（更抗进程被杀），再写 ztools.db
  // 整表替换请走 replaceTableRowsBulk：bulkDocs 一次性提交，420 行从 ~1680 IPC 降到 ~2 IPC
  try {
    const map = readRowsFallback()
    const list = Array.isArray(map[row.tableId]) ? map[row.tableId] : []
    const idx = list.findIndex((r) => r.id === row.id)
    if (idx >= 0) list[idx] = row
    else list.push(row)
    map[row.tableId] = list
    writeRowsFallback(map)
  } catch (e) {}
  try {
    if (window.ztools.db && typeof window.ztools.db.put === 'function') {
      writeRowToDb(row)
    }
  } catch (e) {}
  return row
}

function deleteRow(tableId, rowId) {
  try {
    removeRowFromDb(tableId, rowId)
  } catch (e) {}
  try {
    const map = readRowsFallback()
    const list = Array.isArray(map[tableId]) ? map[tableId] : []
    map[tableId] = list.filter((r) => r.id !== rowId)
    writeRowsFallback(map)
  } catch (e) {}
  return true
}

/**
 * 整表替换 bulk：把「删除旧行 + 写入新行」合并成 1 次 IPC。
 * - dbStorage：单 key 全量，整张 map 一次性 setItem
 * - ztools.db：用 promises.bulkDocs 一次提交 [删旧, 新行] 混合 ops
 * 同步 IPC 时全靠 bulkDocs，全表只需 ~2 次跨进程调用
 */
async function replaceTableRowsBulk(tableId, rows) {
  const list = Array.isArray(rows) ? rows : []
  // 1) dbStorage：read-merge-write 一次
  try {
    const map = readRowsFallback()
    map[tableId] = list
    writeRowsFallback(map)
  } catch (e) {}
  // 2) ztools.db：有 Promise API 就走 bulkDocs，否则降级逐行（保留旧行为兜底）
  try {
    const dbPromises =
      window.ztools &&
      window.ztools.db &&
      window.ztools.db.promises
    if (dbPromises && typeof dbPromises.bulkDocs === 'function' && typeof dbPromises.allDocs === 'function') {
      const prefix = ROW_PREFIX + tableId + ':'
      const old = (await dbPromises.allDocs(prefix)) || []
      const ops = []
      for (const d of old) {
        if (d && d._id && d._rev) {
          ops.push({ _id: d._id, _rev: d._rev, _deleted: true })
        }
      }
      for (const row of list) {
        ops.push({
          _id: ROW_PREFIX + tableId + ':' + row.id,
          rowId: row.id,
          tableId: tableId,
          values: row.values || {},
          createdAt: row.createdAt || 0,
          updatedAt: row.updatedAt || 0
        })
      }
      if (ops.length) await dbPromises.bulkDocs(ops)
      return list.length
    }
  } catch (e) {}
  // 降级（同步 db）：旧行为兜底，老 ZTools 也能跑
  try {
    const old = readRowsFromDb(tableId)
    for (const r of old) removeRowFromDb(tableId, r.id)
    for (const row of list) writeRowToDb(row)
  } catch (e) {}
  return list.length
}

window.services = {
  loadMeta() {
    try {
      const data = window.ztools.dbStorage.getItem(META_KEY)
      const meta = safeParse(data, null)
      if (meta && Array.isArray(meta.tables)) {
        return {
          version: 1,
          tables: meta.tables,
          activeTableId: meta.activeTableId || (meta.tables[0] && meta.tables[0].id) || '',
          multiSeparator: meta.multiSeparator || '、',
          quickTableId: meta.quickTableId || '',
          rowHeightMode: meta.rowHeightMode === 'auto' ? 'auto' : 'fixed'
        }
      }
    } catch (e) {}
    return defaultMeta()
  },

  saveMeta(meta) {
    const next = {
      version: 1,
      tables: (meta && meta.tables) || [],
      activeTableId: (meta && meta.activeTableId) || '',
      multiSeparator: (meta && meta.multiSeparator) || '、',
      quickTableId: (meta && meta.quickTableId) || '',
      rowHeightMode: meta && meta.rowHeightMode === 'auto' ? 'auto' : 'fixed'
    }
    window.ztools.dbStorage.setItem(META_KEY, JSON.stringify(next))
    return next
  },

  listRows(tableId) {
    if (!tableId) return []
    return readRows(tableId)
  },

  putRow(row) {
    if (!row || !row.tableId || !row.id) throw new Error('invalid row')
    return writeRow({
      id: row.id,
      tableId: row.tableId,
      values: row.values || {},
      createdAt: row.createdAt || Date.now(),
      updatedAt: row.updatedAt || Date.now()
    })
  },

  deleteRow(tableId, rowId) {
    return deleteRow(tableId, rowId)
  },

  replaceTableRows(tableId, rows) {
    // 兼容旧名：内部走 bulk 异步
    return replaceTableRowsBulk(tableId, rows)
  },

  replaceTableRowsBulk,

  deleteTableRows(tableId) {
    return replaceTableRowsBulk(tableId, [])
  },

  generateId,

  /** 保存文本文件（utf-8）。返回写入路径。 */
  writeTextFile(filePath, text) {
    const target =
      filePath ||
      path.join(window.ztools.getPath('downloads'), 'easytable-' + Date.now() + '.txt')
    fs.writeFileSync(target, text, { encoding: 'utf-8' })
    return target
  },

  readFile(filePath) {
    return fs.readFileSync(filePath, { encoding: 'utf-8' })
  },

  pickSavePath(options) {
    try {
      return window.ztools.showSaveDialog(options || {})
    } catch (e) {
      return undefined
    }
  },

  pickOpenPath(options) {
    try {
      return window.ztools.showOpenDialog(options || {})
    } catch (e) {
      return undefined
    }
  }
}
