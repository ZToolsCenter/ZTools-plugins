'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createHostStartupManager } = require('../preload/hostStartupManager')

test('uses ZTools isolated storage and only restores a configured stopped router', async () => {
  const values = new Map(); let starts = 0; let status = { running: false, config: { routes: { claude: false } } }
  const manager = createHostStartupManager({ storage: { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) }, getRouterStatus: async () => status, startRouter: async () => { starts += 1; return { ...status, running: true } } })
  assert.deepEqual(manager.getSettings(), { autoStartRouter: false, restoreOnPluginEnter: true })
  assert.equal((await manager.restoreRouter()).reason, 'disabled')
  manager.saveSettings({ autoStartRouter: true })
  assert.equal((await manager.restoreRouter()).reason, 'no-enabled-routes')
  status.config.routes.claude = true
  assert.equal((await manager.restoreRouter()).restored, true); assert.equal(starts, 1)
  status.running = true
  assert.equal((await manager.restoreRouter()).reason, 'already-running'); assert.equal(starts, 1)
})
