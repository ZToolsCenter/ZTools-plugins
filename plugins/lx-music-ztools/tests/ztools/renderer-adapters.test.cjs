const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const { buildSync } = require('esbuild')
function load(file, window = {}) {
  const result = buildSync({ entryPoints: [file], bundle: true, platform: 'browser', format: 'cjs', write: false })
  const context = { module: { exports: {} }, window }
  vm.runInNewContext(result.outputFiles[0].text, context)
  return context.module.exports
}
test('renderer IPC returns sync snapshots and removes normal/once listeners independently', () => {
  const listeners = new Set()
  const host = { readSnapshot: () => ({ volume: 0.5 }), on: (_name, fn) => listeners.add(fn),
    once: (_name, fn) => listeners.add(fn), off: (_name, fn) => listeners.delete(fn), offAll: () => listeners.clear() }
  const ipc = load('src/ztools/rendererIpc.ts', { lxHost: host })
  assert.equal(ipc.rendererSendSync('setting').volume, 0.5)
  let count = 0
  const listener = () => count++
  ipc.rendererOn('event', listener)
  ipc.rendererOnce('event', listener)
  for (const fn of [...listeners]) fn('one')
  for (const fn of [...listeners]) fn('two')
  assert.equal(count, 3)
  ipc.rendererOff('event', listener)
  assert.equal(listeners.size, 0)
})
test('Windows selected paths preserve drive roots and UNC when used by original renderer', () => {
  const paths = load('src/ztools/paths.ts')
  const windows = require('node:path').win32
  const slash = value => value.replaceAll('\\', '/')
  for (const value of ['C:\\音乐\\歌曲.flac', 'C:\\歌曲.mp3', 'C:\\', '\\\\server\\share\\音乐\\歌曲.mp3', '/tmp/歌曲.mp3']) {
    assert.equal(paths.basename(value), windows.basename(value))
    assert.equal(paths.dirname(value), slash(windows.dirname(value)))
    assert.equal(paths.extname(value), windows.extname(value))
  }
  assert.equal(paths.joinPath('C:\\音乐', '歌手', '歌曲.mp3'), 'C:/音乐/歌手/歌曲.mp3')
  assert.equal(paths.joinPath('\\\\server\\share', '音乐', '歌曲.mp3'), '//server/share/音乐/歌曲.mp3')
})
test('original lyric MessagePort handshake transports messages without transferring Node handles', () => {
  const events = new Map(), sent = []
  const host = { on(name, fn) { const set = events.get(name) || new Set(); set.add(fn); events.set(name, set) },
    off: (name, fn) => events.get(name)?.delete(fn), send: (name, params) => sent.push({ name, params }),
    subscribe(name, fn) { this.on(name, fn); return () => this.off(name, fn) } }
  const ipc = load('src/ztools/rendererIpc.ts', { lxHost: host })
  let port, received
  ipc.rendererOn('winMain_process_new_desktop_lyric_client', ({ event }) => { port = event.ports[0]; port.onmessage = value => { received = value.data } })
  for (const fn of events.get('winMain_process_new_desktop_lyric_client')) fn()
  port.postMessage({ action: 'set_play', data: 1234 })
  assert.equal(sent[0].name, 'lyric:port')
  assert.equal(sent[0].params.data, 1234)
  for (const fn of events.get('lyric:port:receive')) fn({ action: 'get_info' })
  assert.equal(received.action, 'get_info')
  port.close()
  assert.equal(events.get('lyric:port:receive').size, 0)
})
