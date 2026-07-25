'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createCodexHistoryManager } = require('../preload/codexHistoryManager')

test('migrates Codex JSONL into the shared bucket with a ledger and restores only recorded sessions', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-codex-unify-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const homeDir = path.join(root, 'home'); const codexDir = path.join(homeDir, '.codex'); const dataDir = path.join(root, 'data')
  const session = path.join(codexDir, 'sessions', '2026', 'session.jsonl'); await fs.mkdir(path.dirname(session), { recursive: true })
  const line = (value) => `${JSON.stringify(value)}\n`
  await fs.writeFile(session, line({ type: 'session_meta', payload: { id: 'official-a', model_provider: 'openai' } }) + line({ type: 'session_meta', payload: { id: 'other', model_provider: 'other' } }))
  const sidecar = {
    isAvailable: () => true,
    updateCodexHistoryToml: async (config, enabled) => enabled
      ? { changed: true, configToml: `${config}model_provider = "ztools_cc_switch"\n`, reason: null }
      : { changed: true, configToml: config.replace(/^model_provider.*\n/m, ''), reason: null },
    updateCodexStateProviders: async ({ sourceProvider }) => sourceProvider === 'openai' ? { changedRows: 1, threadIds: ['thread-a'], backups: [] } : { changedRows: 1, threadIds: ['thread-a'], backups: [] }
  }
  const manager = createCodexHistoryManager({ homeDir, dataDir, sidecar })
  const migrated = await manager.enable({ migrateExisting: true })
  assert.equal(migrated.migratedJsonlFiles, 1); assert.equal(migrated.migratedStateRows, 1)
  let text = await fs.readFile(session, 'utf8'); assert.match(text, /"model_provider":"ztools_cc_switch"/); assert.match(text, /"model_provider":"other"/)
  const status = await manager.getStatus(); assert.equal(status.enabled, true); assert.equal(status.hasBackup, true); assert.equal(status.liveUnified, true)
  const restored = await manager.disable({ restoreBackup: true })
  assert.equal(restored.restoredJsonlFiles, 1); assert.equal(restored.restoredStateRows, 1)
  text = await fs.readFile(session, 'utf8'); assert.match(text, /"model_provider":"openai"/); assert.match(text, /"model_provider":"other"/)
})

test('does not migrate stock history when the live config cannot use the shared bucket', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ztools-codex-unify-conflict-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const homeDir = path.join(root, 'home'); const dataDir = path.join(root, 'data'); let sqliteCalls = 0
  const manager = createCodexHistoryManager({ homeDir, dataDir, sidecar: { isAvailable: () => true, updateCodexHistoryToml: async (config) => ({ changed: false, configToml: config, reason: 'explicit_model_provider' }), updateCodexStateProviders: async () => { sqliteCalls += 1 } } })
  const result = await manager.enable({ migrateExisting: true })
  assert.equal(result.skippedReason, 'live_not_unified'); assert.equal(sqliteCalls, 0)
})
