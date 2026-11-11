const { test } = require('node:test')
const assert = require('node:assert/strict')
const { openDatabase } = require('../../src-ztools/preload/runtime/database.cjs')
const { createSettings } = require('../../src-ztools/preload/runtime/settings.cjs')

test('settings persist atomically and do not accept unknown or mismatched keys', () => {
  const db = openDatabase(':memory:')
  db.exec('CREATE TABLE plugin_kv(namespace TEXT,key TEXT,value TEXT,PRIMARY KEY(namespace,key))')
  const settings = createSettings(db)
  settings.update({ 'player.volume': 0.25 })
  assert.equal(createSettings(db).get()['player.volume'], 0.25)
  assert.throws(() => settings.update({ 'player.volume': 'bad' }))
  assert.equal(settings.get()['player.volume'], 0.25)
  assert.throws(() => settings.update({ arbitrary: 'bad' }))
  db.close()
})

test('original timer dialog numeric minutes persist canonically without weakening other setting types', () => {
  const db = openDatabase(':memory:')
  db.exec('CREATE TABLE plugin_kv(namespace TEXT,key TEXT,value TEXT,PRIMARY KEY(namespace,key))')
  const settings = createSettings(db)
  settings.update({ 'player.waitPlayEndStopTime': 3 })
  assert.equal(createSettings(db).get()['player.waitPlayEndStopTime'], '3')
  for (const bad of [0, -1, 1441, 1.5, Infinity, NaN, 'bad']) {
    assert.throws(() => settings.update({ 'player.volume': 0.2, 'player.waitPlayEndStopTime': bad }))
    assert.equal(settings.get()['player.volume'], 1, 'invalid timer patch must be atomic')
  }
  settings.update({ 'player.waitPlayEndStopTime': '' })
  assert.equal(settings.get()['player.waitPlayEndStopTime'], '')
  db.close()
})
