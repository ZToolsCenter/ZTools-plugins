const { DatabaseSync } = require('node:sqlite')
const { mkdirSync } = require('node:fs')
const path = require('node:path')
let current

/** Adapt the subset of better-sqlite3 used by LX without shipping native bindings. */
function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true })
  const native = new DatabaseSync(file)
  let depth = 0
  const normalize = value => value === undefined ? null : typeof value === 'boolean' ? Number(value) : value
  const parameters = args => args.map(arg => arg && Object.getPrototypeOf(arg) === Object.prototype
    ? Object.fromEntries(Object.entries(arg).map(([key, value]) => [key, normalize(value)])) : normalize(arg))
  const db = {
    exec(sql) { native.exec(sql) },
    pragma(sql) { return native.prepare(`PRAGMA ${sql}`).all().map(row => ({ ...row })) },
    prepare(sql) {
      const statement = native.prepare(sql)
      statement.setAllowUnknownNamedParameters(true)
      return {
        run(...args) { return statement.run(...parameters(args)) },
        get(...args) { const row = statement.get(...parameters(args)); return row && { ...row } },
        all(...args) { return statement.all(...parameters(args)).map(row => ({ ...row })) },
      }
    },
    transaction(fn) {
      return (...args) => {
        const savepoint = `lx_${depth++}`
        native.exec(`SAVEPOINT ${savepoint}`)
        try {
          const result = fn(...args)
          if (result && typeof result.then === 'function') throw new TypeError('SQL transaction callbacks must be synchronous')
          native.exec(`RELEASE SAVEPOINT ${savepoint}`)
          return result
        } catch (error) {
          native.exec(`ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}`)
          throw error
        } finally { depth-- }
      }
    },
    close() { native.close() },
  }
  return db
}

/** Initialize only plugin-local data; never open an existing desktop LX database. */
function init(directory) {
  const schema = require('../upstream/main/worker/dbService/tables.cjs')
  const file = path.join(directory, 'lx-ztools.data.sqlite')
  current = openDatabase(file)
  current.pragma('journal_mode=WAL')
  const exists = current.prepare("SELECT name FROM sqlite_master WHERE name='db_info'").get()
  if (!exists) current.transaction(() => {
    current.exec([...schema.default.values()].join('\n'))
    current.prepare('INSERT INTO db_info (field_name,field_value) VALUES (?,?)').run('version', schema.DB_VERSION)
  })()
  current.exec('CREATE TABLE IF NOT EXISTS plugin_kv(namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(namespace,key))')
  if (exists) require('../upstream/main/worker/dbService/migrate.cjs').default(current)
  return Boolean(exists)
}
module.exports = { openDatabase, init, getDB: () => {
  if (!current) throw new Error('Plugin database is not initialized')
  return current
}, close: () => { current?.close(); current = undefined } }
