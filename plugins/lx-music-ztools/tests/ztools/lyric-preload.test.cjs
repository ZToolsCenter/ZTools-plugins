const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const { EventEmitter } = require('node:events')
const { CHILD } = require('../../src-ztools/preload/runtime/windows.cjs')
test('lyric preload derives the session after about:blank navigation and receives its RPC result', async () => {
  const ipcRenderer = new EventEmitter(), sent = []
  const window = { location: { href: 'about:blank' }, ztools: { sendToParent: (_channel, packet) => sent.push(packet) }, addEventListener() {} }
  vm.runInNewContext(fs.readFileSync('src-ztools/preload/lyric.cjs', 'utf8'), { window, URL, console, setTimeout, clearTimeout,
    require: name => name === 'electron' ? { ipcRenderer } : name === './runtime/windows.cjs' ? require('../../src-ztools/preload/runtime/windows.cjs') : require(name) })
  window.location.href = 'file:///plugin/dist/lyric.html?os=windows&session=real-session'
  const result = window.lxHost.invoke('winLyric_get_config')
  assert.equal(sent[0].session, 'real-session')
  ipcRenderer.emit(CHILD, {}, { session: 'real-session', kind: 'result', id: sent[0].id, result: { fontSize: 36 } })
  assert.equal((await result).fontSize, 36)
})
