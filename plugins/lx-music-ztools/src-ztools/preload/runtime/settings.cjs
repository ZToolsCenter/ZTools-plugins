const defaults = require('../upstream/common/defaultSetting.cjs').default

/** Persist validated LX settings in the same database used for lists and backups. */
function createSettings(db) {
  const read = () => {
    const row = db.prepare("SELECT value FROM plugin_kv WHERE namespace='setting' AND key='app'").get()
    return { ...defaults, ...(row ? JSON.parse(row.value) : {}) }
  }
  return {
    get() { return structuredClone(read()) },
    update(patch) {
      for (const [key, value] of Object.entries(patch)) {
        if (!Object.hasOwn(defaults, key)) throw new Error(`Unknown setting: ${key}`)
        if (value !== null && defaults[key] !== null && typeof value !== typeof defaults[key]) throw new TypeError(`Invalid setting type: ${key}`)
      }
      const next = { ...read(), ...patch }
      db.prepare("INSERT INTO plugin_kv VALUES ('setting','app',?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value").run(JSON.stringify(next))
      return structuredClone(next)
    },
  }
}
module.exports = { createSettings }
