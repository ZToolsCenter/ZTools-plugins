const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { createDataService } = require('../../src-ztools/preload/runtime/data.cjs')
const { createSettings } = require('../../src-ztools/preload/runtime/settings.cjs')
const { createFileService } = require('../../src-ztools/preload/runtime/files.cjs')
const { createBackup } = require('../../src-ztools/preload/runtime/backup.cjs')
const song = id => ({ id, name: id, singer: '歌手', source: 'kw', interval: '03:00', meta: { songId: id, albumName: '专辑', qualitys: [{ type: '128k' }], _qualitys: { '128k': {} } } })
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-backup-'))
  const data = createDataService(directory), settings = createSettings(data.getDatabase()), notices = []
  t.after(() => data.close())
  const backup = createBackup({ data, settings, files: createFileService(data.getDatabase(), directory), onCommit: result => notices.push(result) })
  const document = async value => { const file = path.join(directory, 'input.json'); await fs.writeFile(file, JSON.stringify(value)); return file }
  return { directory, data, settings, notices, backup, document }
}
test('current LX backups round-trip settings and ordered lists through gzip', async t => {
  const x = await fixture(t)
  const input = { type: 'allData_v2', setting: { 'player.volume': 0.37 }, playList: [{ id: 'default', name: '默认', list: [song('b'), song('a')] }, { id: 'one', name: '关联歌单', source: 'kw', sourceListId: '101', locationUpdateTime: 'now', list: [song('c')] }] }
  await x.backup.import(await x.document(input), 'all')
  const output = path.join(x.directory, 'all.lxmc'); await x.backup.export('all', output)
  const decoded = JSON.parse(require('node:zlib').gunzipSync(await fs.readFile(output)))
  assert.equal(decoded.type, 'allData_v2')
  assert.equal(decoded.setting['player.volume'], 0.37)
  assert.deepEqual(decoded.playList.find(list => list.id === 'default').list.map(song => song.id), ['b', 'a'])
  assert.equal(decoded.playList.find(list => list.id === 'one').sourceListId, '101')
  x.settings.update({ 'player.volume': 0.8 })
  await x.backup.import(output, 'all')
  assert.equal(x.settings.get()['player.volume'], 0.37)
})
test('legacy LX default-list typo and old settings migrate through original converters', async t => {
  const x = await fixture(t)
  await x.backup.import(await x.document({ type: 'defautlList', data: { list: [{ songmid: 'old', name: '旧歌', singer: '歌手', source: 'kw', types: [{ type: '128k' }], _types: { '128k': {} } }] } }), 'lists')
  assert.equal(x.data.call('list', 'getListMusics', ['default'])[0].id, 'kw_old')
  await x.backup.import(await x.document({ type: 'setting', data: { version: '1.22.3', player: { volume: 0.21 } } }), 'settings')
  assert.equal(x.settings.get()['player.volume'], 0.21)
})

test('upstream numeric timer minutes in settings backups restore with the same canonical type', async t => {
  const x = await fixture(t)
  await x.backup.import(await x.document({ type: 'setting_v2', data: { 'player.waitPlayEndStopTime': 30 } }), 'settings')
  assert.equal(x.settings.get()['player.waitPlayEndStopTime'], '30')
  assert.equal(x.notices[0].setting['player.waitPlayEndStopTime'], '30')
})
test('invalid backups and SQL failure cannot produce mixed settings/lists or commit notices', async t => {
  const x = await fixture(t), before = x.settings.get()
  for (const input of [{ type: 'allData_v99' }, { type: 'allData_v2', setting: { 'player.volume': 'bad' }, playList: [] }, { type: 'playList_v2', data: [{ id: 'bad', list: [{}] }] }]) {
    await assert.rejects(x.backup.import(await x.document(input), input.type.startsWith('playList') ? 'lists' : 'all'))
    assert.deepEqual(x.settings.get(), before)
    assert.equal(x.notices.length, 0)
  }
  const call = x.data.call
  x.data.call = (...args) => { const result = call(...args); if (args[1] === 'listDataOverwrite') throw new Error('injected SQL boundary failure'); return result }
  await assert.rejects(x.backup.import(await x.document({ type: 'allData_v2', setting: { 'player.volume': 0.99 }, playList: [{ id: 'default', name: 'default', list: [song('new')] }] }), 'all'), /boundary/)
  assert.deepEqual(x.settings.get(), before)
  assert.deepEqual(x.data.call('list', 'getListMusics', ['default']), [])
  assert.equal(x.notices.length, 0)
})
test('large backup retains 100 lists and 10000 songs in order', async t => {
  const x = await fixture(t)
  const lists = Array.from({ length: 100 }, (_, i) => ({ id: `list-${i}`, name: `歌单${i}`, list: Array.from({ length: 100 }, (_, j) => song(`track-${i}-${j}`)) }))
  await x.backup.import(await x.document({ type: 'playList_v2', data: lists }), 'lists')
  assert.deepEqual(x.data.call('list', 'getAllUserList').map(list => list.id), lists.map(list => list.id))
  assert.deepEqual(x.data.call('list', 'getListMusics', ['list-99']).map(song => song.id), lists[99].list.map(song => song.id))
})
test('exports selected single file atomically with BOM and valid CSV escaping', async t => {
  const x = await fixture(t)
  const track = song('one'); track.name = '中文,逗号"与\n换行'
  await x.backup.import(await x.document({ type: 'playList_v2', data: [{ id: 'default', name: '默认', list: [track] }] }), 'lists')
  const other = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-selected-export-'))
  const target = path.join(other, 'selected.csv')
  const files = createFileService(x.data.getDatabase(), x.directory)
  files.scope.grant(target, false)
  const backup = createBackup({ data: x.data, settings: x.settings, files })
  await backup.exportListText(target, 'csv')
  const csv = await fs.readFile(target, 'utf8')
  assert.equal(csv[0], '\ufeff')
  assert.ok(csv.includes('"中文,逗号""与\n换行",歌手,专辑'))
  assert.deepEqual(await fs.readdir(other), ['selected.csv'])
  await assert.rejects(backup.exportListText(path.join(other, 'unselected.csv'), 'csv'), { code: 'PATH_NOT_GRANTED' })
})
