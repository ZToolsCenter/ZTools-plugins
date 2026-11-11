const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const adapt = require('../../build-config/ztools/media-proxy-loader.cjs')
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail }); promise.catch(() => {}); return { promise, resolve, reject } }
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate) }
function load(file, imports, window, globals = {}) {
  const source = adapt.call({ resourcePath: file }, fs.readFileSync(file, 'utf8'))
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, require: name => { if (!imports[name]) throw new Error('Unexpected import ' + name); return imports[name] }, window,
    setTimeout, clearTimeout, setImmediate, console: { log() {}, warn() {} }, ...globals })
  return module.exports
}
function main() {
  const registered = deferred(), resources = [], errors = [], statuses = []
  const song = { id: 'one', meta: {} }, state = { isPlay: { value: false }, playMusicInfo: { musicInfo: song }, playInfo: {}, playedList: [], tempPlayList: [], musicInfo: {} }
  const window = { lx: { isPlayedStop: false }, lxHost: { invoke: () => registered.promise }, i18n: { t: key => key }, app_event: { error: () => errors.push(true) } }
  const imports = {
    '@renderer/plugins/player': { setResource: url => resources.push(url) }, '@renderer/store/player/state': state,
    '@renderer/store/player/action': { setAllStatus: status => statuses.push(status) },
    '@renderer/store/setting': { appSetting: { 'player.autoSkipOnError': false } },
    '../music/index': { getMusicUrl: async () => 'http://source.invalid/private-audio' }, './utils': {},
    '@renderer/utils/message': { requestMsg: {} }, '@renderer/utils/index': {}, '@renderer/store/list/action': {},
    '@renderer/store/list/state': {}, '@renderer/core/dislikeList': {},
  }
  const actions = load('vendor/lx/src/renderer/core/player/action.ts', imports, window)
  return { registered, resources, errors, statuses, state, song, window, actions }
}
test('main playback waits for the host media URL before changing the original audio resource', async () => {
  const x = main(); x.actions.setMusicUrl(x.song); await settle()
  assert.deepEqual(x.resources, [])
  x.registered.resolve('http://127.0.0.1:12345/media-token'); await settle()
  assert.deepEqual(x.resources, ['http://127.0.0.1:12345/media-token'])
})
test('a media registration resolving or rejecting after the song changes cannot mutate current playback', async () => {
  for (const outcome of ['resolve', 'reject']) {
    const x = main(); x.actions.setMusicUrl(x.song); await settle()
    x.state.playMusicInfo.musicInfo = { id: 'new', meta: {} }
    if (outcome === 'resolve') x.registered.resolve('http://127.0.0.1:12345/old')
    else x.registered.reject(new Error('old relay failed'))
    await settle()
    assert.deepEqual(x.resources, []); assert.deepEqual(x.errors, [])
  }
})
test('current media registration errors follow the original player error path', async () => {
  const x = main(); x.actions.setMusicUrl(x.song); await settle()
  x.registered.reject(new Error('媒体代理初始化失败')); await settle()
  assert.deepEqual(x.resources, [])
  assert.equal(x.statuses.at(-1), '媒体代理初始化失败'); assert.equal(x.errors.length, 1)
})
function preload() {
  const registered = deferred(), audio = [], events = new Map()
  let timeupdate
  const song = { musicInfo: { id: 'next', meta: {} }, listId: 'default', isTempPlay: false }
  class Audio {
    constructor() { this.listeners = new Map(); audio.push(this) }
    addEventListener(name, callback) { this.listeners.set(name, callback) }
    removeEventListener(name) { this.listeners.delete(name) }
    set src(value) { this.url = value; queueMicrotask(() => this.listeners.get('canplay')?.()) }
  }
  const imports = {
    '@common/utils/vueTools': { watch() {}, onBeforeUnmount() {} },
    '@renderer/plugins/player': { onTimeupdate(callback) { timeupdate = callback; return () => {} }, getCurrentTime: () => 15 },
    '@renderer/store/player/playProgress': { playProgress: { maxPlayTime: 20, nowPlayTime: 15 } },
    '@renderer/store/player/state': { musicInfo: { id: 'current' } },
    '@renderer/core/player': { getNextPlayMusicInfo: async () => song, resetRandomNextMusicInfo() {} },
    '@renderer/core/music': { getMusicUrl: async () => 'http://source.invalid/next-audio' },
    '@renderer/store/setting': { appSetting: {} },
  }
  const window = { lxHost: { invoke: () => registered.promise }, app_event: { on: (name, callback) => events.set(name, callback), off() {} } }
  load('vendor/lx/src/renderer/core/useApp/usePlayer/usePreloadNextMusic.ts', imports, window, { Audio }).default()
  return { registered, audio, events, start: () => timeupdate() }
}
test('next-track preloading also waits for the registered relay URL', async () => {
  const x = preload(); x.start(); await settle()
  assert.equal(x.audio.length, 0)
  x.registered.resolve('http://127.0.0.1:12345/next'); await settle()
  assert.equal(x.audio[0].url, 'http://127.0.0.1:12345/next')
})
test('a reset preloading identity rejects a late registered URL without opening another Audio', async () => {
  const x = preload(); x.start(); await settle()
  x.events.get('musicToggled')()
  x.registered.resolve('http://127.0.0.1:12345/old-next'); await settle()
  assert.equal(x.audio.length, 0)
})
