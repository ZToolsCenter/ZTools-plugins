const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { createBridge } = require('../../src-ztools/preload/runtime/bridge.cjs')
const { initializeRuntime } = require('../../src-ztools/preload/runtime/index.cjs')
const names = require('../../src-ztools/preload/upstream/common/ipcNames.cjs')

test('original LX IPC handlers persist settings and publish committed list operations', async () => {
  const bridge = createBridge()
  const runtime = initializeRuntime({ bridge, directory: mkdtempSync(join(tmpdir(), 'lx-runtime-')) })
  await bridge.invoke(names.CMMON_EVENT_NAME.set_app_setting, { 'player.volume': 0.35 })
  assert.equal((await bridge.invoke(names.CMMON_EVENT_NAME.get_app_setting))['player.volume'], 0.35)
  const notices = []
  bridge.subscribe(names.PLAYER_EVENT_NAME.list_add, value => notices.push(value))
  const info = { id: 'mine', name: 'My list', source: null, sourceListId: null, locationUpdateTime: null }
  await bridge.invoke(names.PLAYER_EVENT_NAME.list_add, { position: 0, listInfos: [info] })
  assert.deepEqual((await bridge.invoke(names.PLAYER_EVENT_NAME.list_get)).map(x => x.id), ['mine'])
  assert.equal(notices.length, 1)
  await assert.rejects(bridge.invoke(names.PLAYER_EVENT_NAME.list_add, { position: 0, listInfos: [info] }))
  assert.equal(notices.length, 1, 'failed SQL must not publish a list event')
  const lx = require('../../src-ztools/preload/runtime/context.cjs').lx
  const changes = []
  lx.event_app.on('updated_config', keys => changes.push(keys))
  lx.event_app.update_config({ 'player.volume': 0.6 })
  assert.equal((await bridge.invoke(names.CMMON_EVENT_NAME.get_app_setting))['player.volume'], 0.6)
  assert.deepEqual(changes, [['player.volume']])
  const themes = await bridge.invoke(names.WIN_MAIN_RENDERER_EVENT_NAME.get_themes)
  assert.ok(themes.themes.length > 0)
  const custom = { ...themes.themes[0], id: 'user_test', name: 'Test theme', isCustom: true }
  await bridge.invoke(names.WIN_MAIN_RENDERER_EVENT_NAME.save_theme, custom)
  assert.equal((await bridge.invoke(names.WIN_MAIN_RENDERER_EVENT_NAME.get_themes)).userThemes.length, 1)
  await bridge.invoke(names.WIN_MAIN_RENDERER_EVENT_NAME.remove_theme, custom.id)
  assert.equal((await bridge.invoke(names.WIN_MAIN_RENDERER_EVENT_NAME.get_themes)).userThemes.length, 0)
  await runtime.dispose()
})
test('runtime shutdown still closes the database and every service when sync flush fails', async () => {
  const bridge = createBridge()
  const runtime = initializeRuntime({ bridge, directory: mkdtempSync(join(tmpdir(), 'lx-runtime-failure-')) })
  const original = runtime.sync.dispose
  runtime.sync.dispose = async () => { await original(); throw new Error('injected sync flush failure') }
  await assert.rejects(runtime.dispose(), /flush|清理/)
  assert.throws(() => runtime.data.getDatabase(), /not initialized/)
  assert.equal(require('../../src-ztools/preload/runtime/context.cjs').lx, null)
})
