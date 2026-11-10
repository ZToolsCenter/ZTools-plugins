const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { openDatabase } = require('../../src-ztools/preload/runtime/database.cjs')

test('SQL transactions roll back all writes and survive reopening', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'lx-db-test-')), 'test.sqlite')
  let db = openDatabase(path)
  db.exec('CREATE TABLE items (id TEXT PRIMARY KEY, value TEXT)')
  db.prepare('INSERT INTO items VALUES (?,?)').run('one', 'old')
  assert.throws(db.transaction(() => {
    db.prepare('UPDATE items SET value=? WHERE id=?').run('new', 'one')
    db.prepare('INSERT INTO items VALUES (?,?)').run('one', 'duplicate')
  }))
  assert.equal(db.prepare('SELECT value FROM items').get().value, 'old')
  db.close(); db = openDatabase(path)
  assert.equal(db.prepare('SELECT value FROM items').get().value, 'old')
  db.close()
})

test('LX named parameters accept optional fields and surplus music metadata', () => {
  const db = openDatabase(':memory:')
  db.exec('CREATE TABLE items (id TEXT PRIMARY KEY, value TEXT)')
  db.prepare('INSERT INTO items VALUES (@id,@value)').run({ id: 'one', value: undefined, unrelated: 'ignored' })
  assert.deepEqual(db.prepare('SELECT * FROM items').get(), { id: 'one', value: null })
  db.close()
})
