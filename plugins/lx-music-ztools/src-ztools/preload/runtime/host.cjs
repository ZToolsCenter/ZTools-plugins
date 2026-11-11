const fs = require('node:fs')
const path = require('node:path')
const { createKV } = require('./kv.cjs')
const { parseFile } = require('./metadata-parser.cjs')
require('./encodings.cjs')
const { CMMON_EVENT_NAME, WIN_MAIN_RENDERER_EVENT_NAME: names } = require('../upstream/common/ipcNames.cjs')

/** Translate native dialogs and selected-file capabilities through public ZTools APIs. */
function bindHost({ bridge, files, database, directory, ztools, clipboard }) {
  const host = () => { if (!ztools) throw new Error('ZTools host is unavailable'); return ztools }
  const store = createKV(database, 'host')
  bridge.register('metadata:parseFile', ([file, options]) => parseFile(files.scope.authorize(file), options))
  bridge.register('host:openDirectory', file => host().shellShowItemInFolder(files.scope.authorize(file)))
  bridge.register(names.show_select_dialog, async options => {
    const paths = await host().showOpenDialog(options)
    for (const file of paths || []) files.scope.grant(file, fs.statSync(file).isDirectory())
    return { canceled: !paths?.length, filePaths: paths || [] }
  })
  bridge.register(names.show_save_dialog, async options => {
    const filePath = await host().showSaveDialog(options)
    if (filePath) files.scope.grant(filePath, false)
    return { canceled: !filePath, filePath }
  })
  bridge.register('host:openUrl', url => {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) throw new Error('只允许打开 HTTP(S) 链接')
    return host().shellOpenExternal(url)
  })
  bridge.register('host:clipboardWrite', text => { if (typeof text !== 'string') throw new TypeError('Clipboard text must be a string'); clipboard.writeText(text) })
  bridge.register(names.close, () => host().outPlugin(false))
  bridge.register(names.min, () => host().outPlugin(false))
  for (const channel of [names.set_power_save_blocker, names.player_action_set_buttons]) bridge.register(channel, () => ({ supported: false, reason: 'ZTools 未公开独立电源锁和任务栏缩略图按钮接口' }))
  bridge.register(names.quit, () => host().outPlugin(true))
  bridge.register(names.set_app_name, title => { if (typeof title !== 'string') throw new TypeError('Invalid title'); bridge.emit('host:title', title) })
  bridge.register(names.set_window_size, ({ height }) => host().setExpendHeight(height))
  bridge.register(CMMON_EVENT_NAME.clear_env_params_deeplink, () => store.remove('deeplink'))
  const keys = {
    get_sound_effect_eq_preset: 'soundEffects:eq', save_sound_effect_eq_preset: 'soundEffects:eq',
    get_sound_effect_convolution_preset: 'soundEffects:convolution', save_sound_effect_convolution_preset: 'soundEffects:convolution',
  }
  for (const [name, key] of Object.entries(keys)) bridge.register(names[name], name.startsWith('get_') ? () => store.get(key, []) : value => store.set(key, value))
  return { store }
}
module.exports = { bindHost }
