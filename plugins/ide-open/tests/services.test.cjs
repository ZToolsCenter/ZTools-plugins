const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { test, after, mock } = require('node:test')
const { pathToFileURL } = require('node:url')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-open-tests-'))
const appData = path.join(root, 'app-data')
const store = new Map()
const features = new Map()
mock.method(os, 'homedir', () => path.join(root, 'home'))

global.window = {
  ztools: {
    getPath: () => appData,
    isDev: () => false,
    dbStorage: {
      getItem: key => store.get(key),
      setItem: (key, value) => store.set(key, value)
    },
    setFeature: feature => features.set(feature.code, feature),
    removeFeature: code => features.delete(code)
  }
}
require('../public/preload/services.js')
const services = window.services
const historyKey = 'history.recentlyOpenedPathsList'

after(() => {
  fs.rmSync(root, { recursive: true, force: true })
  mock.restoreAll()
  delete global.window
})

function fixturePath(relativePath) {
  const filePath = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  return filePath
}

function writeFixture(relativePath, content) {
  const filePath = fixturePath(relativePath)
  fs.writeFileSync(filePath, content)
  return filePath
}

function createDB(filePath) {
  const db = new DatabaseSync(filePath)
  db.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)')
  return db
}

test('SQLite reads committed WAL records and deletion preserves concurrent IDE history', async () => {
  const dbPath = fixturePath('WAL 中文 & %.vscdb')
  const first = { folderUri: 'file:///tmp/first' }
  const second = { workspace: { configPath: 'file:///tmp/second.code-workspace' } }
  const recent = { folderUri: 'vscode-remote://ssh-remote%2Btest/project' }
  const writer = createDB(dbPath)
  try {
    writer.exec('PRAGMA journal_mode = WAL')
    const put = writer.prepare('INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)')
    put.run(historyKey, JSON.stringify({ entries: [first], other: 'preserved' }))
    writer.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    put.run(historyKey, JSON.stringify({ entries: [null, first, second, recent], other: 'preserved' }))
    put.run('some-other-setting', 'preserved')
    assert.ok(fs.statSync(dbPath + '-wal').size > 0)

    const items = await services.readProjects(dbPath)
    assert.deepEqual(items.map(item => item.type), ['folder', 'workspace', 'remote'])
    assert.deepEqual(items.map(item => item.uri), [first.folderUri, second.workspace.configPath, recent.folderUri])

    await services.deleteProject(dbPath, first.folderUri)
    const get = writer.prepare('SELECT value FROM ItemTable WHERE key = ?')
    assert.deepEqual(JSON.parse(get.get(historyKey).value), {
      entries: [null, second, recent],
      other: 'preserved'
    })
    assert.equal(get.get('some-other-setting').value, 'preserved')
    assert.equal(writer.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  } finally {
    writer.close()
  }
})

test('SQLite deletion leaves another connection’s transaction intact', async () => {
  const dbPath = fixturePath('busy.vscdb')
  const uri = 'file:///tmp/locked'
  const writer = createDB(dbPath)
  try {
    writer.prepare('INSERT INTO ItemTable VALUES (?, ?)').run(historyKey, JSON.stringify({ entries: [uri] }))
    writer.exec('BEGIN IMMEDIATE')
    await assert.rejects(services.deleteProject(dbPath, uri), /database is locked/)
    writer.exec('COMMIT')
    assert.equal((await services.readProjects(dbPath))[0].uri, uri)
  } finally {
    writer.close()
  }
})

test('JetBrains XML resolves the latest version, home macros, entities and labels', async () => {
  const xml = `<application><component name="RecentProjectsManager">
    <option name="additionalInfo"><map>
      <entry key="$USER_HOME$/A &amp; B"><value><RecentProjectMetaInfo>
        <option name="projectName" value="A &amp; B"/>
        <option name="activationTimestamp" value="100"/>
      </RecentProjectMetaInfo></value></entry>
      <entry key="$USER_HOME$/newer"><value><RecentProjectMetaInfo>
        <option name="activationTimestamp" value="200"/>
      </RecentProjectMetaInfo></value></entry>
    </map></option>
  </component></application>`
  writeFixture('JetBrains/IntelliJIdea2025.9/options/recentProjects.xml', '<application/>')
  writeFixture('JetBrains/IntelliJIdea2025.10/options/recentProjects.xml', xml)
  const projects = await services.readProjects(path.join(root, 'JetBrains/IntelliJIdea*/options/recentProjects.xml'))
  assert.deepEqual(projects.map(item => item.name), ['newer', 'A & B'])
  assert.equal(projects[1].path, path.join(os.homedir(), 'A & B'))
})

test('old JetBrains lists and JSON history remain readable without deletion', async () => {
  const xml = writeFixture('old.xml', `<application><component>
    <option name="recentPaths"><list><option value="/tmp/project"/></list></option>
  </component></application>`)
  const localPath = path.join(root, "中文项目's")
  const uri = pathToFileURL(localPath).href
  const json = writeFixture('history.json', JSON.stringify({ openedPathsList: { entries: [{ fileUri: uri }] } }))

  assert.equal((await services.readProjects(xml))[0].name, 'project')
  assert.equal((await services.readProjects(json))[0].path, localPath)
  for (const filePath of [xml, json]) {
    assert.equal(services.canDeleteProjects(filePath), false)
    await assert.rejects(services.deleteProject(filePath, uri), /不支持删除/)
  }
})

test('quick-fill prefers an existing preset and keeps all eight aliases', () => {
  const standard = writeFixture('app-data/Code/User/globalStorage/state.vscdb', '')
  const cursor = writeFixture('app-data/Cursor/storage.json', '{}')
  const presets = services.getQuickFillPresets()
  assert.deepEqual(presets.map(item => item.code), ['vsc', 'cursor', 'codium', 'idea', 'pycharm', 'webstorm', 'goland', 'qoder'])
  assert.equal(presets[0].dbPath, standard)
  assert.equal(presets[1].dbPath, cursor)
  fs.rmSync(standard)
})

test('VS Code presets fall back to the other SQLite location when saved paths are missing', async () => {
  const [shared, standard] = services.getPresets().vscode.dbPaths
  fs.mkdirSync(path.dirname(shared), { recursive: true })
  fs.mkdirSync(path.dirname(standard), { recursive: true })
  const uri = 'file:///tmp/vs-code-project'
  const db = createDB(shared)
  try {
    db.prepare('INSERT INTO ItemTable VALUES (?, ?)').run(historyKey, JSON.stringify({ entries: [uri] }))
  } finally {
    db.close()
  }
  assert.equal((await services.readProjects(standard))[0].uri, uri)
  fs.renameSync(shared, standard)
  assert.equal((await services.readProjects(shared))[0].uri, uri)
})

test('deleting the last migrated IDE leaves the list empty and unregisters its alias', () => {
  const saved = [{ code: 'old-ide', name: 'Old IDE' }, { code: 'ideopen', name: 'Reserved' }]
  store.set('vsc-ides', saved)
  services.registerFeatures()
  assert.deepEqual(services.getIDEs(), saved)
  assert.ok(features.has('old-ide'))
  assert.ok(!features.has('ideopen'))

  services.saveIDEs([])
  services.registerFeatures()
  assert.deepEqual(services.getIDEs(), [])
  assert.ok(!features.has('old-ide'))
})
