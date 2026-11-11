const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const ts = require('typescript')
const adapt = require('../../build-config/ztools/backup-loader.cjs')
const { createBridge } = require('../../src-ztools/preload/runtime/bridge.cjs')
const { initializeRuntime } = require('../../src-ztools/preload/runtime/index.cjs')
const { WIN_MAIN_RENDERER_EVENT_NAME: names } = require('../../src-ztools/preload/upstream/common/ipcNames.cjs')
const song = name => ({ id: name, name, singer: '导出歌手', source: 'local', interval: '01:00', meta: { albumName: '导出专辑' } })

async function fixture(t) {
  const directory = fs.mkdtempSync(join(tmpdir(), 'lx-backup-ui-'))
  const selectedDirectory = fs.mkdtempSync(join(tmpdir(), 'lx-backup-ui-selected-'))
  const pending = [], errors = []
  let selected, confirm = true
  const bridge = createBridge()
  const runtime = initializeRuntime({ bridge, directory, ztools: { showSaveDialog: async () => selected, showOpenDialog: async () => selected ? [selected] : [] } })
  t.after(async () => { await runtime.dispose(); await bridge.dispose() })
  runtime.data.call('list', 'listDataOverwrite', [{ defaultList: [song('默认歌曲')], loveList: [], userList: [{ id: 'custom', name: '自建列表', list: [song('自建歌曲')], source: null, sourceListId: null, locationUpdateTime: null }] }])
  const invoke = (channel, params) => {
    const operation = bridge.invoke(channel, params).catch(error => { errors.push(error) })
    pending.push(operation); return operation
  }
  const dialog = async options => { errors.push(new Error(options.message)) }
  dialog.confirm = async () => confirm
  const imports = {
    '@common/utils/vueTools': { toRaw: value => value }, '@renderer/utils': {},
    '@renderer/utils/ipc': { showSelectDialog: options => invoke(names.show_select_dialog, options), openSaveDir: options => invoke(names.show_save_dialog, options) },
    '@renderer/plugins/Dialog': { dialog }, '@renderer/utils/compositions/useImportTip': { default: () => () => {} },
    '@renderer/plugins/i18n': { useI18n: () => key => key },
    '@renderer/store/list/action': { getListMusics: async id => runtime.data.call('list', 'getListMusics', [id]) },
    '@common/constants': { LIST_IDS: { DEFAULT: 'default' } },
    '@renderer/store/list/state': { defaultList: { id: 'default', name: '默认列表' }, loveList: { id: 'love', name: '我的收藏' }, userLists: runtime.data.call('list', 'getAllUserList') },
    '@renderer/store/setting': { appSetting: runtime.settings.get(), updateSetting() {} }, '@common/utils/migrateSetting': { default() {} },
  }
  const source = adapt(fs.readFileSync('vendor/lx/src/renderer/views/Setting/components/SettingBackup.vue', 'utf8')).match(/<script>([\s\S]*?)<\/script>/)[1]
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, require: name => { if (!imports[name]) throw new Error('Unexpected import ' + name); return imports[name] }, console: { log() {}, error() {} },
    window: { lxHost: { invoke }, lx: { worker: { main: new Proxy({}, { get: (_target, method) => (...args) => invoke('worker:main', { method, args }) }) } } } })
  const buttons = module.exports.default.setup()
  async function click(name, file, choice = true) {
    selected = file; confirm = choice
    await buttons[name]()
    let index = 0
    do {
      for (; index < pending.length; index++) await pending[index]
      await new Promise(setImmediate)
    } while (index < pending.length)
  }
  return { runtime, bridge, selectedDirectory, click, errors }
}

for (const [button, type] of [['handleExportPlayList', 'playList_v2'], ['handleExportSetting', 'setting_v2'], ['handleExportAllData', 'allData_v2']]) {
  test(`${button} saves a real gzip backup from a selected extensionless filename`, async t => {
    const x = await fixture(t), selected = join(x.selectedDirectory, '我的备份')
    await x.click(button, selected)
    assert.deepEqual(x.errors, [])
    const document = JSON.parse(require('node:zlib').gunzipSync(fs.readFileSync(selected + '.lxmc')))
    assert.equal(document.type, type)
    if (type !== 'setting_v2') assert.equal((type === 'allData_v2' ? document.playList : document.data).find(info => info.id === 'default').list[0].name, '默认歌曲')
    else assert.equal(document.data['player.volume'], 1)
  })
}
for (const [button, document] of [
  ['handleImportPlayList', { type: 'playList_v2', data: [{ id: 'default', name: '默认', list: [song('导入歌曲')] }] }],
  ['handleImportSetting', { type: 'setting_v2', data: { 'player.volume': 0.25 } }],
  ['handleImportAllData', { type: 'allData_v2', setting: { 'player.volume': 0.25 }, playList: [{ id: 'default', name: '默认', list: [song('导入歌曲')] }] }],
]) test(`${button} imports through the real selected-file and transaction boundary`, async t => {
  const x = await fixture(t), selected = join(x.selectedDirectory, 'input.json')
  fs.writeFileSync(selected, JSON.stringify(document))
  await x.click(button, selected)
  assert.deepEqual(x.errors, [])
  if (button !== 'handleImportSetting') assert.equal(x.runtime.data.call('list', 'getListMusics', ['default'])[0].name, '导入歌曲')
  if (button !== 'handleImportPlayList') assert.equal(x.runtime.settings.get()['player.volume'], 0.25)
})

for (const [button, format] of [['handleExportPlayListToText', 'txt'], ['handleExportPlayListToCsv', 'csv']]) {
  test(`${button} merges into its extensionless selected file without granting its siblings`, async t => {
    const x = await fixture(t), selected = join(x.selectedDirectory, '我的歌单')
    await x.click(button, selected)
    assert.deepEqual(x.errors, [])
    const text = fs.readFileSync(selected + '.' + format, 'utf8')
    assert.equal(text[0], '\ufeff'); assert.ok(text.includes('默认歌曲')); assert.ok(text.includes('自建歌曲'))
    await assert.rejects(x.bridge.invoke('files:call', { method: 'readFile', args: [selected + '.' + format] }), { code: 'PATH_NOT_GRANTED' })
    await assert.rejects(x.bridge.invoke('files:call', { method: 'saveStrToFile', args: [join(x.selectedDirectory, 'unselected.txt'), 'no'] }), { code: 'PATH_NOT_GRANTED' })
    assert.deepEqual(fs.readdirSync(x.selectedDirectory), ['我的歌单.' + format])
  })
  test(`${button} exports each list only inside a selected directory`, async t => {
    const x = await fixture(t)
    await x.click(button, x.selectedDirectory, false)
    assert.deepEqual(x.errors, [])
    for (const name of ['默认列表', '我的收藏', '自建列表']) assert.equal(fs.readFileSync(join(x.selectedDirectory, `lx_list_${name}.${format}`), 'utf8')[0], '\ufeff')
    assert.ok(fs.readFileSync(join(x.selectedDirectory, `lx_list_自建列表.${format}`), 'utf8').includes('自建歌曲'))
  })
}
