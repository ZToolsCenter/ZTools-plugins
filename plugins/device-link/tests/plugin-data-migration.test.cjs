'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EARLY_KEY_FALLBACK_DIR, preparePluginDataMigration } = require('../public/preload/core/plugin-data-migration')

test('moves attachments and the credential key into pluginData, rewrites records, and removes userData', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-migration-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const legacy = path.join(root, 'userData', 'device-link')
  const pluginData = path.join(root, 'pluginData')
  const oldAttachment = path.join(legacy, 'attachments', 'old.txt')
  fs.mkdirSync(path.dirname(oldAttachment), { recursive: true })
  fs.writeFileSync(oldAttachment, 'payload')
  fs.writeFileSync(path.join(legacy, 'credential-key-v2'), Buffer.alloc(32, 7))
  const docs = [{ _id: 'device-link:message:m1', _rev: '1-a', type: 'device-link-message', attachments: [{ id: 'a1', path: oldAttachment }] }]
  const db = {
    async allDocs() { return docs },
    async put(doc) { docs.splice(0, 1, doc); return { ok: true } },
  }

  const migration = preparePluginDataMigration(db, pluginData, legacy)
  assert.equal(migration.dataDir, pluginData)
  await migration.ready
  assert.equal(fs.existsSync(legacy), false)
  assert.equal(fs.readFileSync(path.join(pluginData, 'attachments', 'old.txt'), 'utf8'), 'payload')
  assert.equal(fs.readFileSync(path.join(pluginData, 'credential-key-v2')).length, 32)
  assert.equal(docs[0].attachments[0].path, path.join(pluginData, 'attachments', 'old.txt'))
})

test('preserves an early 3.2 key inside pluginData while promoting the legacy key', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-key-migration-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const legacy = path.join(root, 'legacy')
  const pluginData = path.join(root, 'pluginData')
  fs.mkdirSync(legacy, { recursive: true })
  fs.mkdirSync(pluginData, { recursive: true })
  fs.writeFileSync(path.join(legacy, 'credential-key-v2'), Buffer.alloc(32, 1))
  fs.writeFileSync(path.join(pluginData, 'credential-key-v2'), Buffer.alloc(32, 2))
  const db = { async allDocs() { return [] }, async put() { return { ok: true } } }

  const migration = preparePluginDataMigration(db, pluginData, legacy)
  await migration.ready
  assert.deepEqual(fs.readFileSync(path.join(pluginData, 'credential-key-v2')), Buffer.alloc(32, 1))
  assert.deepEqual(fs.readFileSync(path.join(pluginData, EARLY_KEY_FALLBACK_DIR, 'credential-key-v2')), Buffer.alloc(32, 2))
  assert.equal(fs.existsSync(legacy), false)
})

test('retains userData when database path rewriting fails', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-migration-fail-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const legacy = path.join(root, 'legacy')
  const pluginData = path.join(root, 'pluginData')
  const oldAttachment = path.join(legacy, 'attachments', 'old.txt')
  fs.mkdirSync(path.dirname(oldAttachment), { recursive: true })
  fs.writeFileSync(oldAttachment, 'payload')
  const db = {
    async allDocs() { return [{ _id: 'device-link:message:m1', type: 'device-link-message', attachments: [{ path: oldAttachment }] }] },
    async put() { return { ok: false, error: 'conflict' } },
  }
  const migration = preparePluginDataMigration(db, pluginData, legacy)
  await assert.rejects(migration.ready, /更新附件路径失败/)
  assert.equal(fs.existsSync(legacy), true)
})
