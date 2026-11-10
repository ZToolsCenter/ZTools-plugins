const PREFIX = 'lx-music:framework:'
const probes = require('./probes.cjs')
const { randomUUID } = require('node:crypto')
const { createBridge } = require('./runtime/bridge.cjs')
const { createLifecycle } = require('./runtime/lifecycle.cjs')
const { initializeRuntime } = require('./runtime/index.cjs')
const os = require('node:os')
const { clipboard } = require('electron')
const bridge = createBridge()
bridge.setSnapshot('host:env', { platform: process.platform, release: os.release(), homedir: os.homedir(), tmpdir: os.tmpdir(), arch: os.arch(), cpus: os.cpus().map(({ model }) => ({ model })) })
const runtime = initializeRuntime({ bridge, directory: window.ztools.getPath('pluginData'), ztools: window.ztools, clipboard })
window.lxHost = Object.fromEntries(['invoke', 'send', 'readSnapshot', 'on', 'once', 'off', 'offAll', 'subscribe'].map(key => [key, bridge[key]]))
let lifecycleProbe
window.services = {
  clipboardReadText() { return clipboard.readText() },
  subscribe(channel, listener) { return bridge.subscribe(channel, listener) },
  startLifecycleProbe() {
    if (!lifecycleProbe) {
      lifecycleProbe = { id: randomUUID(), ticks: 0 }
      setInterval(() => lifecycleProbe.ticks++, 100)
    }
    return { ...lifecycleProbe }
  },
  getLifecycleProbe() { return { ...lifecycleProbe } },
  probeCapabilities() { return probes.probeCapabilities(window.ztools) },
  probeSourceIsolation() { return probes.probeSourceIsolation() },
  probeWorkerIsolation(publicKey) { return probes.probeWorkerIsolation(publicKey) },
  /** 返回当前宿主与 Node 运行环境。 */
  diagnose() { return { app: window.ztools.getAppName(), version: window.ztools.getAppVersion(), node: process.versions.node } },
  /** 读取插件进入计数。 */
  getLaunchCount() { return Number(window.ztools.dbStorage.getItem(PREFIX + 'launches')) || 0 },
  /** 记录进入事件并返回累计次数。 */
  recordLaunch() {
    const next = this.getLaunchCount() + 1
    window.ztools.dbStorage.setItem(PREFIX + 'launches', next)
    return next
  },
  /** 验证插件存储写入与回读，随后清理临时键。 */
  checkStorage() {
    const key = PREFIX + 'probe'
    const value = require('node:crypto').randomUUID()
    try { window.ztools.dbStorage.setItem(key, value); return window.ztools.dbStorage.getItem(key) === value }
    finally { window.ztools.dbStorage.removeItem(key) }
  }
}
const lifecycle = createLifecycle({
  initialize: async () => {},
  onEnter: action => { window.services.recordLaunch(); bridge.emit('lifecycle:enter', action) },
  onHide: () => bridge.emit('lifecycle:hide'),
  onDetach: () => bridge.emit('lifecycle:detach'),
  dispose: async () => { await runtime.dispose(); await bridge.dispose() },
})
const report = error => bridge.emit('bridge:error', { code: error.code, message: error.message })
window.ztools.onPluginEnter(action => { void lifecycle.enter(action).catch(report) })
window.ztools.onPluginOut(isKill => { void lifecycle.out(isKill).catch(report) })
window.ztools.onPluginDetach(() => { void lifecycle.detach().catch(report) })
