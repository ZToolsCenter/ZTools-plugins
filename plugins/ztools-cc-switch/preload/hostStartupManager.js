'use strict'

function createHostStartupManager(options = {}) {
  const storage = options.storage
  const getRouterStatus = options.getRouterStatus
  const startRouter = options.startRouter
  const key = 'cc-switch:ztools-startup-v1'
  function getSettings() {
    const value = storage.getItem(key)
    return { autoStartRouter: Boolean(value?.autoStartRouter), restoreOnPluginEnter: value?.restoreOnPluginEnter !== false }
  }
  function saveSettings(patch = {}) {
    const current = getSettings()
    const next = { autoStartRouter: patch.autoStartRouter === undefined ? current.autoStartRouter : Boolean(patch.autoStartRouter), restoreOnPluginEnter: patch.restoreOnPluginEnter === undefined ? current.restoreOnPluginEnter : Boolean(patch.restoreOnPluginEnter) }
    storage.setItem(key, next); return next
  }
  async function restoreRouter() {
    if (!getSettings().autoStartRouter) return { restored: false, reason: 'disabled' }
    const status = await getRouterStatus()
    if (status.running) return { restored: false, reason: 'already-running', status }
    if (!Object.values(status.config?.routes || {}).some(Boolean)) return { restored: false, reason: 'no-enabled-routes', status }
    return { restored: true, status: await startRouter() }
  }
  return { getSettings, saveSettings, restoreRouter }
}

module.exports = { createHostStartupManager }
