const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { transformSync } = require('esbuild')
const { reactive, ref, computed, watch, nextTick, createSSRApp } = require('vue')
const loader = require('../../build-config/ztools/media-device-loader.cjs')
const settingsLoader = require('../../build-config/ztools/host-settings-loader.cjs')
const routingLoader = require('../../build-config/ztools/audio-routing-loader.cjs')
const engineLoader = require('../../build-config/ztools/engine-routing-loader.cjs')
const defaults = require('../../src-ztools/preload/upstream/common/defaultSetting.cjs').default
const tick = async () => { await nextTick(); await new Promise(resolve => setImmediate(resolve)); await nextTick() }
function surface(extra = {}) {
  const events = new EventTarget()
  return { CustomEvent, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events), ...extra }
}
function load(source, modules, globals) {
  const context = { module: { exports: {} }, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, ...globals,
    require(name) { return modules[name] || require(name) } }
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, context)
  return context.module.exports
}
function fixture(t, options = {}) {
  const setting = reactive({ ...defaults, 'player.mediaDeviceId': options.id || 'default', 'player.isMediaDeviceRemovedStopPlay': true })
  const saved = [], sinks = [], handlers = new Map(), cleanup = [], errors = []
  let devices = options.devices || [{ kind: 'audiooutput', deviceId: 'default', label: 'Speakers', groupId: 'builtin' }, { kind: 'audiooutput', deviceId: 'usb', label: 'Headset', groupId: 'usb' }]
  const mediaDevices = { async enumerateDevices() { return devices }, addEventListener: (event, fn) => handlers.set(event, fn), removeEventListener: event => handlers.delete(event) }
  const Audio = function () {}
  if (!options.noSink) Audio.prototype.setSinkId = () => {}
  const AudioContext = function () {}
  if (!options.noContextSink) AudioContext.prototype.setSinkId = () => {}
  const setSink = options.setSink || (async id => { sinks.push(id) })
  let pauses = 0, changed = 0
  const modules = {
    '@common/utils/vueTools': { ref, watch, onBeforeUnmount: fn => cleanup.push(fn) },
    '@renderer/core/player/action': { pause() { pauses++ } },
    '@renderer/plugins/Dialog': { dialog: () => Promise.resolve() },
    '@renderer/plugins/player': { setMediaDeviceId: setSink },
    '@renderer/store/player/state': { isPlay: ref(true) },
    '@renderer/store/setting': { appSetting: setting, saveMediaDeviceId(id) { saved.push(id); setting['player.mediaDeviceId'] = id } },
  }
  const window = Object.assign(options.surface || surface(), { Audio, AudioContext, HTMLMediaElement: Audio, i18n: { t: value => value }, lx: {}, app_event: { playerDeviceChanged() { changed++ } } })
  const hook = load(loader(fs.readFileSync('vendor/lx/src/renderer/core/useApp/usePlayer/useMediaDevice.ts', 'utf8')), modules,
    { navigator: { mediaDevices }, window })
  hook.default()
  t.after(() => cleanup.forEach(fn => fn()))
  return { setting, saved, sinks, handlers, cleanup, mediaDevices, errors, surface: window, setDevices(value) { devices = value }, get pauses() { return pauses }, get changed() { return changed } }
}

test('enumeration without setSinkId leaves system output usable and removes an unusable saved selection', async t => {
  const x = fixture(t, { id: 'usb', noSink: true })
  await tick()
  assert.equal(x.setting['player.mediaDeviceId'], 'default')
  assert.deepEqual(x.sinks, [])
})

test('legacy contexts without output routing allow only system default even after settings import', async t => {
  const x = fixture(t, { id: 'usb', noContextSink: true })
  await tick()
  assert.equal(x.setting['player.mediaDeviceId'], 'default')
  x.setting['player.mediaDeviceId'] = 'usb'; await tick()
  assert.equal(x.setting['player.mediaDeviceId'], 'default')
  assert.deepEqual(x.sinks, [])
})

test('successful device selection is persisted only after the real output switch finishes', async t => {
  let release, active = 'default'
  const x = fixture(t, { setSink: async id => { if (id === 'usb') await new Promise(resolve => { release = resolve }); active = id } })
  await tick()
  x.setting['player.mediaDeviceId'] = 'usb'
  await tick()
  assert.equal(x.saved.includes('usb'), false)
  release(); await tick()
  assert.equal(active, 'usb')
  assert.equal(x.saved.at(-1), 'usb')
})

test('unplugging the selected output pauses even when another output has the same label', async t => {
  const x = fixture(t, { id: 'usb', devices: [{ kind: 'audiooutput', deviceId: 'default', label: 'Audio', groupId: 'builtin' }, { kind: 'audiooutput', deviceId: 'usb', label: 'Audio', groupId: 'usb' }] })
  await tick()
  x.setDevices([{ kind: 'audiooutput', deviceId: 'default', label: 'Audio', groupId: 'builtin' }])
  await x.handlers.get('devicechange')(); await tick()
  assert.equal(x.pauses, 1)
  assert.equal(x.setting['player.mediaDeviceId'], 'default')
})

test('a failed selection and failed default fallback restore the last applied selection', async t => {
  let fail = false
  const x = fixture(t, { id: 'usb', setSink: async id => { if (fail) throw new Error('device denied') } })
  await tick(); fail = true
  x.setting['player.mediaDeviceId'] = 'default'
  await tick()
  assert.equal(x.setting['player.mediaDeviceId'], 'usb')
})

test('a disposed hook cannot save the result of a pending output switch', async t => {
  let release
  const x = fixture(t, { setSink: async id => { if (id === 'usb') await new Promise(resolve => { release = resolve }) } })
  await tick(); x.setting['player.mediaDeviceId'] = 'usb'; await tick()
  x.cleanup.forEach(fn => fn()); release(); await tick()
  assert.equal(x.saved.includes('usb'), false)
})

test('a newer return to the previous output wins over an in-flight selection', async t => {
  let release, active = 'default'
  const x = fixture(t, { setSink: async id => { if (id === 'usb') await new Promise(resolve => { release = resolve }); active = id } })
  await tick(); x.setting['player.mediaDeviceId'] = 'usb'; await tick()
  x.setting['player.mediaDeviceId'] = 'default'; await tick()
  release(); await tick()
  assert.equal(active, 'default')
  assert.equal(x.setting['player.mediaDeviceId'], 'default')
})

test('an enumeration rejection restores the previous selection without stopping playback', async t => {
  const x = fixture(t, { id: 'usb' })
  await tick()
  x.mediaDevices.enumerateDevices = async () => { throw new Error('permission denied') }
  x.setting['player.mediaDeviceId'] = 'default'; await tick()
  assert.equal(x.setting['player.mediaDeviceId'], 'usb')
  assert.equal(x.pauses, 0)
})

test('a newer selection wins after a stale default fallback completes', async t => {
  let release, defaults = 0, active = 'usb'
  const x = fixture(t, { id: 'usb', setSink: async id => {
    if (id === 'default') {
      if (++defaults === 1) throw new Error('first default attempt failed')
      await new Promise(resolve => { release = resolve })
    }
    active = id
  } })
  await tick(); x.setting['player.mediaDeviceId'] = 'default'; await tick()
  x.setting['player.mediaDeviceId'] = 'usb'; await tick()
  release(); await tick()
  assert.equal(active, 'usb')
  assert.equal(x.setting['player.mediaDeviceId'], 'usb')
})

function desktopSettings(options = {}) {
  const setting = reactive({ ...defaults, 'player.mediaDeviceId': 'usb' }), saved = [], switches = [], confirmations = []
  const dialog = async () => {}
  dialog.confirm = async payload => { confirmations.push(payload); return options.confirm !== false }
  const modules = { '@common/utils/vueTools': { ref, computed, watch, onMounted() {}, onBeforeUnmount() {} },
    '@renderer/store/setting': { appSetting: setting, updateSetting(patch) { saved.push(patch); Object.assign(setting, patch) }, saveMediaDeviceId(id) { setting['player.mediaDeviceId'] = id } },
    '@renderer/plugins/Dialog': { dialog }, '@renderer/plugins/i18n': { useI18n: () => key => key },
    '@renderer/plugins/player': { setMediaDeviceId: async id => { switches.push(id); if (options.failSwitch) throw new Error('output denied') } },
    '@common/utils': { isLinux: false }, '@renderer/utils/ipc': { getSystemFonts: async () => [] }, '@renderer/utils/pickrTools': { pickrTools: {} },
    '@simonwep/pickr': { default: { create() { return { on() { return this }, setColor() {}, destroyAndRemove() {} } } } }, }
  const source = settingsLoader.call({ resourcePath: '/SettingDesktopLyric.vue' }, fs.readFileSync('vendor/lx/src/renderer/views/Setting/components/SettingDesktopLyric.vue', 'utf8'))
  const Audio = function () {}, AudioContext = function () {}
  Audio.prototype.setSinkId = () => {}
  if (options.modern) AudioContext.prototype.setSinkId = () => {}
  const component = load(source.match(/<script>([\s\S]*?)<\/script>/)[1], modules, { navigator: { mediaDevices: { enumerateDevices: async () => [] } }, window: { Audio, AudioContext } }).default
  const api = component.setup()
  const expression = source.match(/id="setting_desktop_lyric_audio_visualization"[^\n]*@update:model-value="([^"]+)"/)[1]
  return { saved, switches, confirmations, setting, async enable() { return Function('api', '$event', `with (api) { return ${expression} }`)(api, true) } }
}

test('desktop spectrum asks before switching a selected non-default output', async () => {
  const x = desktopSettings({ confirm: false })
  await x.enable()
  assert.equal(x.confirmations.length, 1)
  assert.equal(x.setting['desktopLyric.audioVisualization'], false)
  assert.deepEqual(x.switches, [])
})

test('desktop spectrum stays off when returning to the default output fails', async () => {
  const x = desktopSettings({ failSwitch: true })
  await x.enable()
  assert.equal(x.setting['desktopLyric.audioVisualization'], false)
  assert.equal(x.setting['player.mediaDeviceId'], 'usb')
})

function playSettings(options = {}) {
  const setting = reactive({ ...defaults, 'player.mediaDeviceId': 'usb' }), saved = [], confirmations = []
  const dialog = async () => {}
  dialog.confirm = async payload => { confirmations.push(payload); return options.confirm !== false }
  const Audio = function () {}
  if (!options.noSink) Audio.prototype.setSinkId = () => {}
  const AudioContext = function () {}
  if (!options.legacy) AudioContext.prototype.setSinkId = () => {}
  const modules = { '@common/utils/vueTools': { ref, watch, onBeforeUnmount() {} },
    '@renderer/store/setting': { appSetting: setting, updateSetting(patch) { saved.push(patch); Object.assign(setting, patch) }, saveMediaDeviceId(id) { setting['player.mediaDeviceId'] = id } },
    '@renderer/plugins/Dialog': { dialog }, '@renderer/plugins/i18n': { useI18n: () => key => key },
    '@renderer/plugins/player': { hasInitedAdvancedAudioFeatures: () => Boolean(options.advanced), setMediaDeviceId: async () => { if (options.failSwitch) throw new Error('output denied') } },
    '@common/utils': { isMac: false }, '@renderer/core/music/utils': { TRY_QUALITYS_LIST: [] },
    '@renderer/core/player/utils': { setPowerSaveBlocker() {} }, '@renderer/store/player/state': { isPlay: ref(true) } }
  const source = settingsLoader.call({ resourcePath: '/SettingPlay.vue' }, fs.readFileSync('vendor/lx/src/renderer/views/Setting/components/SettingPlay.vue', 'utf8'))
  const window = Object.assign(options.surface || surface(), { Audio, AudioContext })
  const api = load(source.match(/<script>([\s\S]*?)<\/script>/)[1], modules, { navigator: { mediaDevices: { enumerateDevices: async () => [], addEventListener() {}, removeEventListener() {} } }, window }).default.setup()
  return { api, setting, saved, confirmations, source }
}

async function renderPlaySettings(page) {
  const template = require('pug').render(page.source.match(/<template lang="pug">([\s\S]*?)<\/template>/)[1])
  const compiled = require('@vue/compiler-sfc').compileTemplate({ source: template, filename: 'SettingPlay.vue', id: 'audio-settings-audit' })
  if (compiled.errors.length) throw compiled.errors[0]
  const render = load(compiled.code, {}, {}).render
  const app = createSSRApp({ setup: () => page.api, render })
  app.config.warnHandler = () => {}
  app.config.globalProperties.$t = key => key
  return require('@vue/server-renderer').renderToString(app)
}

test('max output channels stays off when switching to the system default fails', async () => {
  const x = playSettings({ failSwitch: true, legacy: true })
  await x.api.handleUpdateMaxOutputChannelCount(true)
  assert.equal(x.setting['player.isMaxOutputChannelCount'], false)
  assert.equal(x.api.isMaxOutputChannelCount.value, false)
  assert.equal(x.setting['player.mediaDeviceId'], 'usb')
})

test('max output channels control follows externally restored settings', async () => {
  const x = playSettings()
  x.setting['player.isMaxOutputChannelCount'] = true
  await tick()
  assert.equal(x.api.isMaxOutputChannelCount.value, true)
})

test('play settings report missing sink capability even when devices can be enumerated', () => {
  const x = playSettings({ noSink: true })
  assert.equal(x.api.audioCapability.select, false)
  assert.equal(x.api.audioCapability.watch, false)
})

function detailControls(failSwitch = false, modern = false) {
  const setting = reactive({ ...defaults, 'player.mediaDeviceId': 'usb' })
  const dialog = async () => {}
  dialog.confirm = async () => true
  const modules = { '@common/utils/vueTools': { ref }, '@renderer/plugins/i18n': { useI18n: () => key => key },
    '@renderer/store/player/state': {}, '@renderer/store/player/action': {},
    '@renderer/utils/compositions/useNextTogglePlay': () => ({}), '@renderer/utils/compositions/useToggleDesktopLyric': () => ({}),
    '@renderer/plugins/Dialog': { dialog }, '@renderer/plugins/player': { setMediaDeviceId: async () => { if (failSwitch) throw new Error('output denied') } },
    '@renderer/store/setting': { appSetting: setting, saveMediaDeviceId(id) { setting['player.mediaDeviceId'] = id }, setEnableAudioVisualization(enabled) { setting['player.audioVisualization'] = enabled } } }
  const source = routingLoader(fs.readFileSync('vendor/lx/src/renderer/components/layout/PlayDetail/components/ControlBtns.vue', 'utf8'))
  const Audio = function () {}, AudioContext = function () {}
  Audio.prototype.setSinkId = () => {}
  if (modern) AudioContext.prototype.setSinkId = () => {}
  const api = load(source.match(/<script>([\s\S]*?)<\/script>/)[1], modules, { navigator: { mediaDevices: { enumerateDevices: async () => [] } }, window: { Audio, AudioContext } }).default.setup()
  return { setting, api }
}

test('main spectrum stays off when returning to the default output fails', async () => {
  const x = detailControls(true)
  await x.api.toggleAudioVisualization()
  assert.equal(x.setting['player.audioVisualization'], false)
  assert.equal(x.setting['player.mediaDeviceId'], 'usb')
})

test('main spectrum enables after the default output switch succeeds', async () => {
  const x = detailControls()
  await x.api.toggleAudioVisualization()
  assert.equal(x.setting['player.audioVisualization'], true)
  assert.equal(x.setting['player.mediaDeviceId'], 'default')
})

test('modern output remains selectable after DSP has already been initialized', async () => {
  const x = playSettings({ advanced: true })
  x.api.mediaDeviceId.value = 'default'
  await x.api.handleMediaDeviceIdChnage()
  assert.equal(x.setting['player.mediaDeviceId'], 'default')
})

test('modern maximum channel control preserves a custom output', async () => {
  const x = playSettings()
  await x.api.handleUpdateMaxOutputChannelCount(true)
  assert.equal(x.setting['player.isMaxOutputChannelCount'], true)
  assert.equal(x.setting['player.mediaDeviceId'], 'usb')
  assert.equal(x.confirmations.length, 0)
})

test('modern desktop spectrum preserves a custom output without requesting a default switch', async () => {
  const x = desktopSettings({ modern: true })
  await x.enable()
  assert.equal(x.setting['desktopLyric.audioVisualization'], true)
  assert.equal(x.setting['player.mediaDeviceId'], 'usb')
  assert.equal(x.confirmations.length, 0)
  assert.deepEqual(x.switches, [])
})

test('modern main spectrum preserves a custom output', async () => {
  const x = detailControls(false, true)
  await x.api.toggleAudioVisualization()
  assert.equal(x.setting['player.audioVisualization'], true)
  assert.equal(x.setting['player.mediaDeviceId'], 'usb')
})

test('modern sound effects omit the obsolete custom-output conflict warning', async () => {
  const source = routingLoader(fs.readFileSync('vendor/lx/src/renderer/components/common/SoundEffectBtn/index.vue', 'utf8'))
  const script = source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
  const AudioContext = function () {}
  AudioContext.prototype.setSinkId = () => {}
  const api = load(script + '\nexport { visible, showTip }', { '@common/utils/vueTools': { ref, watch },
    './BiquadFilter.vue': {}, './AudioPanner.vue': {}, './AudioConvolution.vue': {}, './PitchShifter.vue': {},
    '@renderer/store/setting': { appSetting: { 'player.mediaDeviceId': 'usb' } } }, { defineProps() {}, window: { AudioContext } })
  api.visible.value = true; await tick()
  assert.equal(api.showTip.value, false)
})

function engine(options = {}) {
  let audio, context, owners = 0, sourceAttached = false, elementCalls = 0
  const node = () => ({ connect() {}, disconnect() {}, gain: { value: 0 }, frequency: { value: 0 }, Q: { value: 0 } })
  class Audio {
    constructor() { audio = this; this.sinkId = ''; owners++ }
    addEventListener() {}
    async setSinkId(id) {
      elementCalls++
      if (id === this.sinkId) return
      if (options.delay) await options.delay(id)
      // Chromium's WebAudioSourceProviderImpl drops the element sink after SetClient.
      if (sourceAttached) throw new DOMException('The operation could not be performed and was aborted', 'AbortError')
      if (id === options.audioFailure) throw new Error('element output denied')
      this.sinkId = id
    }
  }
  class AudioContext {
    constructor(options) { context = this; this.sinkId = options.sinkId || ''; this.destination = { channelCount: 2 } }
    createAnalyser() { return node() }
    createBiquadFilter() { return node() }
    createGain() { return node() }
    createDynamicsCompressor() { return node() }
    createConvolver() { return node() }
    createPanner() { return node() }
    createMediaElementSource() { sourceAttached = true; return node() }
    async setSinkId(id) { if (id === options.contextFailure) throw new Error('context output denied'); this.sinkId = id }
  }
  if (options.legacy) delete AudioContext.prototype.setSinkId
  const source = engineLoader(fs.readFileSync('vendor/lx/src/renderer/plugins/player/index.ts', 'utf8'))
  const api = load(source, {}, { window: { Audio, AudioContext, app_event: { on() {} } }, setInterval, clearInterval })
  api.createAudio()
  return { api, get audio() { return audio }, get context() { return context }, get owners() { return owners }, get elementCalls() { return elementCalls } }
}

test('creating DSP after a custom selection gives the sole audio context the same real sink', async () => {
  const x = engine()
  await x.api.setMediaDeviceId('usb')
  x.api.getBiquadFilter()
  assert.equal(x.audio.sinkId, 'usb')
  assert.equal(x.context.sinkId, 'usb')
  assert.equal(x.owners, 1)
})

test('a custom selection after DSP creation switches the active context without touching the captured element', async () => {
  const x = engine()
  x.api.getBiquadFilter()
  await x.api.setMediaDeviceId('usb')
  assert.equal(x.elementCalls, 0)
  assert.equal(x.audio.sinkId, '')
  assert.equal(x.context.sinkId, 'usb')
  assert.equal(x.api.getMediaDeviceId(), 'usb')
})

test('a rejected context switch preserves the previous active route without touching the captured element', async () => {
  const x = engine({ contextFailure: 'bad' })
  await x.api.setMediaDeviceId('usb'); x.api.getBiquadFilter()
  const before = x.elementCalls
  await assert.rejects(x.api.setMediaDeviceId('bad'), /context output denied/)
  assert.equal(x.elementCalls, before)
  assert.equal(x.audio.sinkId, 'usb')
  assert.equal(x.context.sinkId, 'usb')
  assert.equal(x.api.getMediaDeviceId(), 'usb')
})

test('a rejected element switch before DSP leaves the last actual route available for later DSP', async () => {
  const x = engine({ audioFailure: 'bad' })
  await x.api.setMediaDeviceId('usb')
  await assert.rejects(x.api.setMediaDeviceId('bad'), /element output denied/)
  assert.equal(x.audio.sinkId, 'usb')
  x.api.getBiquadFilter()
  assert.equal(x.context.sinkId, 'usb')
})

test('removing an effect leaves the currently selected output unchanged', async () => {
  const x = engine()
  await x.api.setMediaDeviceId('usb'); x.api.getBiquadFilter()
  x.api.setConvolver(null, 0, 0)
  x.api.setMaxOutputChannelCount(false)
  assert.equal(x.audio.sinkId, 'usb')
  assert.equal(x.context.sinkId, 'usb')
})

test('legacy contexts reject custom selection but still create DSP on the system default', async () => {
  const x = engine({ legacy: true })
  await assert.rejects(x.api.setMediaDeviceId('usb'), /默认输出/)
  x.api.getBiquadFilter()
  assert.equal(x.audio.sinkId, '')
  assert.equal(x.context.sinkId, '')
})

test('creating DSP during a pending imported output switch joins the final selected route', async () => {
  let release
  const x = engine({ delay: id => id === 'usb' ? new Promise(resolve => { release = resolve }) : undefined })
  const selection = x.api.setMediaDeviceId('usb')
  await tick()
  x.api.getBiquadFilter()
  release(); await selection
  assert.equal(x.audio.sinkId, '')
  assert.equal(x.context.sinkId, 'usb')
  assert.equal(x.api.getMediaDeviceId(), 'usb')
  assert.equal(x.owners, 1)
})

test('a failed context selection during element-to-DSP ownership transfer preserves the last successful output', async () => {
  let release
  const x = engine({ contextFailure: 'bad', delay: id => id === 'bad' ? new Promise(resolve => { release = resolve }) : undefined })
  await x.api.setMediaDeviceId('usb')
  const selection = x.api.setMediaDeviceId('bad')
  await tick(); x.api.getBiquadFilter(); release()
  await assert.rejects(selection, /context output denied/)
  assert.equal(x.api.getMediaDeviceId(), 'usb')
  assert.equal(x.context.sinkId, 'usb')
  assert.equal(x.owners, 1)
})

test('an imported custom output and already enabled DSP persist the same actual route', async t => {
  const x = engine(); x.api.getBiquadFilter()
  const device = fixture(t, { id: 'usb', setSink: x.api.setMediaDeviceId })
  await tick()
  assert.equal(device.setting['player.mediaDeviceId'], 'usb')
  assert.equal(device.saved.at(-1), 'usb')
  assert.equal(x.audio.sinkId, '')
  assert.equal(x.context.sinkId, 'usb')
  assert.equal(x.api.getMediaDeviceId(), 'usb')
})

test('a context-rejected output never appears as a persisted selected device', async t => {
  const x = engine({ contextFailure: 'usb' }); x.api.getBiquadFilter()
  const device = fixture(t, { setSink: x.api.setMediaDeviceId })
  await tick(); device.setting['player.mediaDeviceId'] = 'usb'; await tick()
  assert.equal(device.saved.includes('usb'), false)
  assert.equal(device.setting['player.mediaDeviceId'], 'default')
  assert.equal(x.audio.sinkId, '')
  assert.equal(x.context.sinkId, '')
  assert.equal(x.api.getMediaDeviceId(), 'default')
})

test('a failed output switch is rendered as a visible settings alert and a later successful retry clears it', async t => {
  let failed = true
  const device = fixture(t, { setSink: async id => { if (failed && id === 'usb') throw new DOMException('Device could not be opened', 'AbortError') } })
  const page = playSettings({ surface: device.surface })
  await tick(); device.setting['player.mediaDeviceId'] = 'usb'; await tick()
  const html = await renderPlaySettings(page)
  assert.match(html, /role="alert"/)
  assert.match(html, /已恢复系统默认输出/)
  assert.match(html, /AbortError/)
  failed = false; device.setting['player.mediaDeviceId'] = 'usb'; await tick()
  assert.doesNotMatch(await renderPlaySettings(page), /role="alert"/)
})

test('a failed default fallback alert says the last successful device setting was retained', async t => {
  let failed = false
  const device = fixture(t, { id: 'usb', setSink: async () => { if (failed) throw new DOMException('Device could not be opened', 'AbortError') } })
  const page = playSettings({ surface: device.surface })
  await tick(); failed = true; device.setting['player.mediaDeviceId'] = 'default'; await tick()
  assert.equal(device.setting['player.mediaDeviceId'], 'usb')
  const html = await renderPlaySettings(page)
  assert.match(html, /role="alert"/)
  assert.match(html, /默认输出也切换失败/)
  assert.match(html, /保留上一次成功的设备设置/)
})

test('opening playback settings after a failed output switch retains its visible error', async t => {
  const device = fixture(t, { setSink: async id => { if (id === 'usb') throw new DOMException('Device aborted', 'AbortError') } })
  await tick(); device.setting['player.mediaDeviceId'] = 'usb'; await tick()
  const page = playSettings({ surface: device.surface })
  assert.match(await renderPlaySettings(page), /已恢复系统默认输出/)
})
