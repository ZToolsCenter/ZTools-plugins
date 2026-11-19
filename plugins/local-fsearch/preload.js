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
const everything = windows ? require('./everything.cjs').createEverything({ getConfiguredPath: () => window.ztools.dbStorage.getItem('fsearch-everything-es') || '' }) : null
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
  async chooseEverythingCli() {
    if (!windows) return false
    const files = await window.ztools.showOpenDialog({ title: '选择从 Everything 官网下载的 es.exe', properties: ['openFile'], filters: [{ name: 'ES 命令行工具', extensions: ['exe'] }] })
    if (!files?.length) return false
    const target = files[0]
    if (!path.isAbsolute(target) || path.basename(target).toLowerCase() !== 'es.exe') throw new Error('请选择 ES 命令行工具 es.exe，不是 Everything.exe')
    const stat = await require('node:fs/promises').stat(target)
    if (!stat.isFile()) throw new Error('ES 路径不是文件')
    const error = window.ztools.dbStorage.setItem('fsearch-everything-es', target)
    if (error !== undefined) throw new Error(error.error || '保存 ES 路径失败')
    return true
  },
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
