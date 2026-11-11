const defaults = require('../upstream/common/defaultSetting.cjs').default

// LX's timer dialog emits a number although its unset default is a string.
// Keep one storage format for normal updates and upstream backup imports.
function normalizeSettingPatch(patch) {
  const normalized = { ...patch }
  for (const [key, value] of Object.entries(normalized)) {
    if (!Object.hasOwn(defaults, key)) throw new Error(`Unknown setting: ${key}`)
    if (key === 'player.waitPlayEndStopTime' && value !== '') {
      const minutes = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new TypeError(`Invalid timer minutes: ${key}`)
      normalized[key] = String(minutes)
    } else if (value !== null && defaults[key] !== null && typeof value !== typeof defaults[key]) throw new TypeError(`Invalid setting type: ${key}`)
  }
  return normalized
}

/** Persist validated LX settings in the same database used for lists and backups. */
function createSettings(db) {
  const read = () => {
    const row = db.prepare("SELECT value FROM plugin_kv WHERE namespace='setting' AND key='app'").get()
    return { ...defaults, ...(row ? JSON.parse(row.value) : {}) }
  }
  return {
    get() { return structuredClone(read()) },
    update(patch) {
      const next = { ...read(), ...normalizeSettingPatch(patch) }
      db.prepare("INSERT INTO plugin_kv VALUES ('setting','app',?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value").run(JSON.stringify(next))
      return structuredClone(next)
    },
  }
}
module.exports = { createSettings, normalizeSettingPatch }
