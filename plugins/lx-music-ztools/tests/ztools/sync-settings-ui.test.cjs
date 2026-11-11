const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const vm = require('node:vm')
const { once } = require('node:events')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const ts = require('typescript')
const vue = require('vue')
const adapt = require('../../build-config/ztools/sync-settings-loader.cjs')
const { createBridge } = require('../../src-ztools/preload/runtime/bridge.cjs')
const { initializeRuntime } = require('../../src-ztools/preload/runtime/index.cjs')
const { CMMON_EVENT_NAME, WIN_MAIN_RENDERER_EVENT_NAME: names } = require('../../src-ztools/preload/upstream/common/ipcNames.cjs')

async function fixture(t) {
  const rejectPeer = http.createServer((_req, res) => res.end('unsupported peer'))
  rejectPeer.listen(0, '127.0.0.1'); await once(rejectPeer, 'listening')
  t.after(() => new Promise(resolve => rejectPeer.close(resolve)))
  const reserve = http.createServer()
  reserve.listen(0, '0.0.0.0'); await once(reserve, 'listening')
  const port = reserve.address().port
  await new Promise(resolve => reserve.close(resolve))
  const directory = fs.mkdtempSync(join(tmpdir(), 'lx-sync-setting-ui-'))
  const bridge = createBridge(), runtime = initializeRuntime({ bridge, directory })
  t.after(() => runtime.dispose())
  await bridge.invoke(CMMON_EVENT_NAME.set_app_setting, { 'sync.mode': 'server', 'sync.enable': true, 'sync.server.port': String(port), 'sync.client.host': `http://127.0.0.1:${rejectPeer.address().port}` })
  await runtime.sync.start({ mode: 'server', port })
  const appSetting = vue.reactive(runtime.settings.get())
  const sync = vue.reactive({ mode: 'server', enable: true, server: { port: String(port) }, client: { host: appSetting['sync.client.host'] } })
  const pending = []
  const imports = {
    '@common/utils/vueTools': vue,
    '@renderer/store': { sync, proxy: {}, isFullscreen: { value: false }, windowSizeList: [] },
    '@renderer/store/setting': { appSetting },
    '@renderer/utils/ipc': { setWindowSize() {}, sendSyncAction(action) { const operation = bridge.invoke(names.sync_action, action); pending.push(operation); return operation } },
    '@root/lang': { setLanguage() {} }, '../apiSource': { setUserApi() {} },
  }
  const source = adapt(fs.readFileSync('vendor/lx/src/renderer/core/useApp/useSettingSync.ts', 'utf8'))
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, require: name => { if (!imports[name]) throw new Error('Unexpected import ' + name); return imports[name] },
    document: { documentElement: { style: {} } }, window: { setLang() {} }, console })
  const scope = vue.effectScope()
  scope.run(() => module.exports.default())
  t.after(() => scope.stop())
  bridge.subscribe(names.on_config_change, patch => Object.assign(appSetting, patch))
  async function settle() { await vue.nextTick(); for (let index = 0; index < pending.length; index++) await pending[index].catch(() => {}); await vue.nextTick() }
  async function importSetting(patch) {
    const file = join(directory, 'import.json')
    fs.writeFileSync(file, JSON.stringify({ type: 'setting_v2', data: patch }))
    await bridge.invoke('backup:import', { kind: 'settings', path: file })
    await settle()
  }
  return { bridge, runtime, sync, appSetting, port, importSetting, settle }
}

test('importing only the sync role retires the old server and starts the selected client role', async t => {
  const x = await fixture(t)
  await x.importSetting({ 'sync.mode': 'client' })
  assert.equal(x.sync.mode, 'client')
  assert.equal(x.runtime.sync.getStatus().mode, 'client')
  assert.equal(x.runtime.sync.getStatus().status, false, 'the deliberately unsupported peer cannot authenticate')
  const released = http.createServer()
  released.listen(x.port, '0.0.0.0'); await once(released, 'listening')
  await new Promise(resolve => released.close(resolve))
})

test('a role import with an empty client host still closes the previously active server', async t => {
  const x = await fixture(t)
  await x.importSetting({ 'sync.mode': 'client', 'sync.client.host': '' })
  assert.equal(x.sync.mode, 'client')
  assert.equal(x.runtime.sync.getStatus().status, false)
  const released = http.createServer()
  released.listen(x.port, '0.0.0.0'); await once(released, 'listening')
  await new Promise(resolve => released.close(resolve))
})
