const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { createBridge } = require('../../src-ztools/preload/runtime/bridge.cjs')
const { initializeRuntime } = require('../../src-ztools/preload/runtime/index.cjs')
const { WIN_MAIN_RENDERER_EVENT_NAME: music, DISLIKE_EVENT_NAME: dislike, PLAYER_EVENT_NAME: list } = require('../../src-ztools/preload/upstream/common/ipcNames.cjs')
const { SPLIT_CHAR, LIST_IDS } = require('../../src-ztools/preload/upstream/common/constants.cjs')

async function fixture(t) {
  const bridge = createBridge()
  const runtime = initializeRuntime({ bridge, directory: mkdtempSync(join(tmpdir(), 'lx-settings-data-')) })
  t.after(async () => { await runtime.dispose(); await bridge.dispose() })
  await bridge.invoke('runtime:ready')
  return bridge
}
const song = { id: 'audit_song', name: '设置验证歌曲', singer: '歌手', source: 'kw', interval: '00:01', meta: { songId: 'audit_song', albumName: '专辑', _qualitys: {} } }

test('each Other-page cache action clears its SQLite namespace and keeps the other three intact', async t => {
  const bridge = await fixture(t)
  await bridge.invoke(music.save_other_source, { id: 'audit-original', list: [song] })
  await bridge.invoke(music.save_music_url, { id: song.id, url: 'https://example.test/audit.mp3' })
  await bridge.invoke(music.save_lyric_raw, { id: song.id, lyrics: { lyric: '[00:00.000]原歌词' } })
  await bridge.invoke(music.save_lyric_edited, { id: song.id, lyrics: { lyric: '[00:00.100]调整歌词' } })
  const operations = [
    [music.get_other_source_count, music.clear_other_source],
    [music.get_music_url_count, music.clear_music_url],
    [music.get_lyric_raw_count, music.clear_lyric_raw],
    [music.get_lyric_edited_count, music.clear_lyric_edited],
  ]
  for (const [count] of operations) assert.equal(await bridge.invoke(count), 1)
  for (let index = 0; index < operations.length; index++) {
    await bridge.invoke(operations[index][1])
    for (let other = 0; other < operations.length; other++) {
      assert.equal(await bridge.invoke(operations[other][0]), other <= index ? 0 : 1)
    }
  }
})

test('Other-page dislike editing saves all rule forms, publishes the change and supports an empty save', async t => {
  const bridge = await fixture(t)
  const changes = []
  bridge.subscribe(dislike.overwrite_dislike_music_infos, value => changes.push(value))
  const rules = `不喜欢的歌\n${SPLIT_CHAR.DISLIKE_NAME}不喜欢的歌手\n指定歌${SPLIT_CHAR.DISLIKE_NAME}指定歌手`
  await bridge.invoke(dislike.overwrite_dislike_music_infos, rules)
  const saved = await bridge.invoke(dislike.get_dislike_music_infos)
  assert.equal(saved.musicNames.has('不喜欢的歌'), true)
  assert.equal(saved.singerNames.has('不喜欢的歌手'), true)
  assert.equal(saved.names.has(`指定歌${SPLIT_CHAR.DISLIKE_NAME}指定歌手`), true)
  assert.deepEqual(changes, [rules])
  await bridge.invoke(dislike.overwrite_dislike_music_infos, '')
  const empty = await bridge.invoke(dislike.get_dislike_music_infos)
  assert.equal(empty.rules, '')
  assert.equal(empty.musicNames.size + empty.singerNames.size + empty.names.size, 0)
  assert.deepEqual(changes, [rules, ''])
})

test('Other-page clear-all lists removes custom lists and all built-in list songs through the original IPC', async t => {
  const bridge = await fixture(t)
  const info = { id: 'audit_list', name: '设置验证列表', source: null, sourceListId: null, locationUpdateTime: null }
  await bridge.invoke(list.list_add, { position: 0, listInfos: [info] })
  for (const id of [LIST_IDS.DEFAULT, LIST_IDS.LOVE, LIST_IDS.TEMP, info.id]) {
    await bridge.invoke(list.list_music_add, { id, musicInfos: [song], addMusicLocationType: 'top' })
    assert.equal((await bridge.invoke(list.list_music_get, id)).length, 1)
  }
  await bridge.invoke(list.list_data_overwire, { defaultList: [], loveList: [], tempList: [], userList: [] })
  assert.deepEqual(await bridge.invoke(list.list_get), [])
  for (const id of [LIST_IDS.DEFAULT, LIST_IDS.LOVE, LIST_IDS.TEMP]) assert.deepEqual(await bridge.invoke(list.list_music_get, id), [])
})
