// 仅向渲染进程暴露插件自身 KV 存储，不授予任意文件读写能力。
const DB_PREFIX = 'promptforge:'
window.kvStorage = {
  get(key) {
    const doc = window.ztools.db.get(DB_PREFIX + key)
    return doc ? doc.data : null
  },
  set(key, value) {
    const id = DB_PREFIX + key
    const existing = window.ztools.db.get(id)
    const doc = existing
      ? { _id: id, _rev: existing._rev, data: value }
      : { _id: id, data: value }
    return window.ztools.db.put(doc)
  },
  remove(key) {
    const id = DB_PREFIX + key
    const existing = window.ztools.db.get(id)
    if (existing) return window.ztools.db.remove(existing)
  }
}
