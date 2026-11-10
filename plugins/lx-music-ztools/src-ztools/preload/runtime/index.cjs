const { createDataService } = require('./data.cjs')
const { createSettings } = require('./settings.cjs')
const context = require('./context.cjs')
const { createAppEvent, createListEvent, createDislikeEvent } = require('../upstream/main/event/index.cjs')
const { CMMON_EVENT_NAME, WIN_MAIN_RENDERER_EVENT_NAME } = require('../upstream/common/ipcNames.cjs')
const modules = require('../upstream/main/worker/dbService/modules/index.cjs')
const registerList = require('../upstream/main/modules/commonRenderers/list/rendererEvent.cjs').default
const registerDislike = require('../upstream/main/modules/commonRenderers/dislike/rendererEvent.cjs').default
const registerMusic = require('../upstream/main/modules/winMain/rendererEvent/music.cjs').default
const registerDownload = require('../upstream/main/modules/winMain/rendererEvent/download.cjs').default
const listEvents = require('../upstream/main/modules/commonRenderers/list/winRendererEvent.cjs')
const dislikeEvents = require('../upstream/main/modules/commonRenderers/dislike/winRendererEvent.cjs')
const { createNetwork } = require('./network.cjs')
const dns = require('node:dns/promises')
const { createKV } = require('./kv.cjs')
const defaultHotKey = require('../upstream/common/defaultHotKey.cjs').default
const { createSources } = require('./source/manager.cjs')
const { createThemes } = require('./themes.cjs')
const { getFonts } = require('font-list')
const { bindPlayer } = require('./player.cjs')
const { createFileService } = require('./files.cjs')
const { callMainWorker } = require('./worker-main.cjs')
const path = require('node:path')
const { bindHost } = require('./host.cjs')

/** Bind the original LX event/data handlers to plugin-local services. */
function initializeRuntime({ bridge, directory, ztools, clipboard }) {
  const data = createDataService(directory)
  const settings = createSettings(data.getDatabase())
  const network = createNetwork()
  const kv = createKV(data.getDatabase(), 'data')
  const config = createKV(data.getDatabase(), 'host')
  const themes = createThemes(data.getDatabase())
  const files = createFileService(data.getDatabase(), directory)
  const sources = createSources({ database: data.getDatabase(), network,
    onStatus: status => bridge.emit(WIN_MAIN_RENDERER_EVENT_NAME.user_api_status, status),
    onAlert: alert => bridge.emit(WIN_MAIN_RENDERER_EVENT_NAME.user_api_show_update_alert, alert) })
  const dbService = {}
  for (const [namespace, methods] of Object.entries(modules)) {
    for (const method of Object.keys(methods)) dbService[method] = (...args) => Promise.resolve(data.call(namespace, method, args))
  }
  const lx = context.lx = { database: data.getDatabase(), settings, tempDir: path.join(directory, 'cache/music'), worker: { dbService }, event_app: createAppEvent(), event_list: createListEvent(), event_dislike: createDislikeEvent(), appSetting: settings.get() }
  context.bridge = bridge
  bindPlayer({ bridge, lx, names: WIN_MAIN_RENDERER_EVENT_NAME })
  bindHost({ bridge, files, database: data.getDatabase(), directory, ztools, clipboard })
  bridge.register('runtime:ready', () => true)
  bridge.register('network:fetch', options => network.request(options).result)
  bridge.register('network:cancel', id => network.cancel(id))
  bridge.register('dns:lookup', ({ hostname, options }) => dns.lookup(hostname, options))
  bridge.register('files:call', ({ method, args }) => files.call(method, args))
  bridge.register('worker:main', ({ method, args }) => callMainWorker(files, method, args))
  bridge.register(CMMON_EVENT_NAME.get_env_params, () => ({ cmdParams: {}, deeplink: null }))
  bridge.register(WIN_MAIN_RENDERER_EVENT_NAME.get_data, key => kv.get(key))
  bridge.register(WIN_MAIN_RENDERER_EVENT_NAME.save_data, ({ path, data }) => kv.set(path, data))
  bridge.register(WIN_MAIN_RENDERER_EVENT_NAME.get_hot_key, () => config.get('hotkeys', defaultHotKey))
  bridge.register(CMMON_EVENT_NAME.get_system_fonts, () => getFonts())
  bridge.register(WIN_MAIN_RENDERER_EVENT_NAME.get_themes, () => themes.getAll())
  bridge.register(WIN_MAIN_RENDERER_EVENT_NAME.save_theme, theme => themes.save(theme))
  bridge.register(WIN_MAIN_RENDERER_EVENT_NAME.remove_theme, id => themes.remove(id))
  bridge.register(WIN_MAIN_RENDERER_EVENT_NAME.get_user_api_list, () => sources.list())
  bridge.register(WIN_MAIN_RENDERER_EVENT_NAME.import_user_api, script => sources.importScript(script))
  bridge.register(WIN_MAIN_RENDERER_EVENT_NAME.set_user_api, id => sources.activate(id))
  bridge.register(WIN_MAIN_RENDERER_EVENT_NAME.get_user_api_status, () => sources.getStatus())
  bridge.register(WIN_MAIN_RENDERER_EVENT_NAME.remove_user_api, async ids => {
    const removingActive = ids.includes(sources.getStatus().apiInfo?.id)
    await sources.remove(ids)
    const remaining = sources.list()
    if (removingActive) lx.event_app.update_config({ 'common.apiSource': remaining[0]?.id || 'temp' })
    return remaining
  })
  bridge.register(WIN_MAIN_RENDERER_EVENT_NAME.request_user_api, input => sources.request(input))
  bridge.register(WIN_MAIN_RENDERER_EVENT_NAME.request_user_api_cancel, key => sources.cancel(key))
  bridge.register(WIN_MAIN_RENDERER_EVENT_NAME.user_api_set_allow_update_alert, ({ id, enable }) => sources.setAllowUpdate(id, enable))
  bridge.register(CMMON_EVENT_NAME.get_app_setting, () => settings.get())
  lx.event_app.on('updated_config', (_keys, patch) => bridge.emit(WIN_MAIN_RENDERER_EVENT_NAME.on_config_change, patch))
  bridge.register(CMMON_EVENT_NAME.set_app_setting, patch => lx.event_app.update_config(patch))
  bridge.setSnapshot(CMMON_EVENT_NAME.get_app_setting, lx.appSetting)
  for (const register of [registerList, registerDislike, registerMusic, registerDownload]) register()
  const unregisterList = listEvents.registerRendererEvents((channel, params) => bridge.emit(channel, params))
  const unregisterDislike = dislikeEvents.registerRendererEvents((channel, params) => bridge.emit(channel, params))
  return { data, settings, async dispose() {
    unregisterList(); unregisterDislike()
    lx.event_app.removeAllListeners(); lx.event_list.removeAllListeners(); lx.event_dislike.removeAllListeners()
    await sources.dispose(); network.dispose(); data.close(); context.lx = null; context.bridge = null
  } }
}
module.exports = { initializeRuntime }
