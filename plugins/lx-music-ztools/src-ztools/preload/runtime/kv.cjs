/** Store per-plugin JSON values inside the shared SQL transaction boundary. */
function createKV(db, namespace) {
  return {
    get(key, fallback) {
      const row = db.prepare('SELECT value FROM plugin_kv WHERE namespace=? AND key=?').get(namespace, key)
      return row ? JSON.parse(row.value) : fallback
    },
    set(key, value) {
      if (value === undefined) { db.prepare('DELETE FROM plugin_kv WHERE namespace=? AND key=?').run(namespace, key); return }
      db.prepare('INSERT INTO plugin_kv VALUES (?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value').run(namespace, key, JSON.stringify(value))
    },
    remove(key) { db.prepare('DELETE FROM plugin_kv WHERE namespace=? AND key=?').run(namespace, key) },
  }
}
module.exports = { createKV }
