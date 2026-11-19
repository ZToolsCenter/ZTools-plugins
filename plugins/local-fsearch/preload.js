const { createLatest } = require('./latest.cjs')
const mac = require('./client.cjs')
const categories = require('./categories.cjs')
const path = require('node:path')
const { createSearch } = require('./search.cjs')
const os = require('node:os')
const { createHost } = require('./host.cjs')
const { createIntegration, syncPlatformFeatures } = require('./integration.cjs')
const { imageType, readImage } = require('./images.cjs')
const windows = process.platform === 'win32'
const everything = windows ? require('./everything.cjs').createEverything() : null
const closeConnections = everything?.closeConnections || mac.closeConnections
const host = createHost(window.ztools, mac.request, undefined, { everything })
const integration = createIntegration(window.ztools, host, (payload, context) => mac.exchange(payload, undefined, context), { windows, searchPush: everything?.push })
const readiness = everything || require('./readiness.cjs').createReadiness(mac.request)
window.ztools.onMainPush(integration.queryPush, integration.selectPush)
const search = createLatest(everything?.search || createSearch(mac.request))
const preview = createLatest((value, context) => host.preview(value.options, value.path, context))

window.fsearchApi = {
  windows,
  imageType,
  readImage,
  categories: categories.map(({ id, label, icon, contentSupported = false, contentLabel }) => ({ id, label, icon, contentSupported, contentLabel })),
  status: everything?.status || (() => mac.request({ op: 'status' })),
  connection: options => readiness.inspect(options),
  async openHelp(topic) {
    const links = { everything: 'https://www.voidtools.com/downloads/', install: 'https://github.com/noahdunnagan/fsearch/releases/tag/v0.2.1', permissions: 'https://github.com/noahdunnagan/fsearch#full-disk-access', project: 'https://github.com/lifeek23/ztools-fsearch' }
    if (!Object.hasOwn(links, topic)) throw new Error('未知的帮助入口')
    const result = await window.ztools.shellOpenExternal(links[topic])
    if (result?.success !== true) throw new Error(result?.error || '未能打开帮助网页')
    return true
  },
  ...host,
  search: value => search.submit(value),
  invalidateSearch: () => search.invalidate(),
  preview: (options, path) => preview.submit({ options, path }),
  invalidatePreview: () => preview.invalidate(),
  dispose() { search.dispose(); preview.dispose(); integration.suspend(); closeConnections(); host.dispose() },
  ...integration,
  suspend() { search.dispose(); preview.dispose(); integration.suspend(); closeConnections() },
  name: target => path.basename(target),
  home: () => os.homedir()
}

try {
  syncPlatformFeatures(window.ztools, process.platform)
  integration.syncFeatures()
} catch (error) { window.fsearchApi.integrationError = error.message }
