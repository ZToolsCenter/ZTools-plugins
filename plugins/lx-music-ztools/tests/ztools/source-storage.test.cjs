const { test } = require('node:test')
const assert = require('node:assert/strict')
const { openDatabase } = require('../../src-ztools/preload/runtime/database.cjs')
const { createSources } = require('../../src-ztools/preload/runtime/source/manager.cjs')
const script = '/**\n * @name SQL source\n */\nlx.send("inited",{sources:{}})'

test('failed source persistence does not expose an uncommitted imported script', () => {
  const db = openDatabase(':memory:')
  db.exec('CREATE TABLE plugin_kv(namespace TEXT,key TEXT,value TEXT,PRIMARY KEY(namespace,key)); CREATE TRIGGER fail_source BEFORE INSERT ON plugin_kv WHEN NEW.namespace=\'sources\' BEGIN SELECT RAISE(ABORT,\'full\'); END;')
  const sources = createSources({ database: db })
  assert.throws(() => sources.importScript(script), /full/)
  assert.equal(sources.list().length, 0)
  db.close()
})
