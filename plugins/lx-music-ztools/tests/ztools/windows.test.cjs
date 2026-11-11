const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { createBridge } = require('../../src-ztools/preload/runtime/bridge.cjs')
const { createWindows, PARENT, CHILD } = require('../../src-ztools/preload/runtime/windows.cjs')
const { WIN_LYRIC_RENDERER_EVENT_NAME: names, WIN_MAIN_RENDERER_EVENT_NAME: mainNames } = require('../../src-ztools/preload/upstream/common/ipcNames.cjs')
function fixture(t) {
  const bridge = createBridge(), ipcRenderer = new EventEmitter(), calls = [], windows = []
  const lx = { appSetting: { ...require('../../src-ztools/preload/upstream/common/defaultSetting.cjs').default }, event_app: new EventEmitter() }
  lx.event_app.update_config = patch => { Object.assign(lx.appSetting, patch); lx.event_app.emit('updated_config', Object.keys(patch), patch) }
  const ztools = { getPrimaryDisplay: () => ({ workArea: { x: -1280, y: 0, width: 1280, height: 720 } }),
    getDisplayNearestPoint: () => ztools.getPrimaryDisplay(), createBrowserWindow(url, options) {
      const win = { url, bounds: { ...options }, dead: false, webContents: { id: 42, send: (...args) => calls.push(args) },
        destroy() { this.dead = true }, isDestroyed() { return this.dead }, getBounds() { return this.bounds },
        setBounds(bounds) { this.bounds = bounds }, setAlwaysOnTop: value => calls.push(['top', value]), setIgnoreMouseEvents: value => calls.push(['ignore', value]), setSkipTaskbar() {}, moveTop() {} }
      windows.push(win); return win
    } }
  const service = createWindows({ bridge, ipcRenderer, ztools, lx, ready: true })
  t.after(() => service.dispose())
  return { service, bridge, ipcRenderer, ztools, lx, calls, windows }
}
test('lyrics reuse original port messages and reject another window/session', async t => {
  const x = fixture(t), received = []
  x.bridge.subscribe(mainNames.process_new_desktop_lyric_client, () => received.push('connected'))
  x.bridge.subscribe('lyric:port:receive', data => received.push(data))
  await x.service.openLyrics()
  const win = x.windows[0], session = new URL(win.url, 'file:///').searchParams.get('session')
  const packet = { session, kind: 'invoke', id: '1', channel: names.request_main_window_channel }
  x.ipcRenderer.emit(PARENT, { senderId: 99 }, packet)
  assert.equal(received.length, 0)
  x.ipcRenderer.emit(PARENT, { senderId: 42 }, packet)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(received[0], 'connected')
  await x.bridge.invoke('lyric:port', { action: 'set_play', data: 1500 })
  assert.ok(x.calls.some(([channel, packet]) => channel === CHILD && packet.kind === 'event' && packet.params?.data === 1500))
  x.ipcRenderer.emit(PARENT, { senderId: 42 }, { session, kind: 'invoke', id: '2', channel: 'lyric:port', params: { action: 'get_info' } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(received.at(-1).action, 'get_info')
  await x.service.closeLyrics()
  assert.equal(win.dead, true)
  await x.service.dispose()
  assert.equal(x.ipcRenderer.listenerCount(PARENT), 0)
})
test('lyrics clamp bounds to a negative-coordinate display and apply top/click-through', async t => {
  const x = fixture(t)
  x.lx.appSetting['desktopLyric.x'] = -20
  x.lx.appSetting['desktopLyric.y'] = 700
  x.lx.appSetting['desktopLyric.width'] = 900
  x.lx.appSetting['desktopLyric.height'] = 100
  x.lx.appSetting['desktopLyric.isLock'] = true
  x.lx.appSetting['desktopLyric.isAlwaysOnTop'] = true
  await x.service.openLyrics()
  const bounds = x.windows[0].bounds
  assert.equal(bounds.x, -900)
  assert.equal(bounds.y, 620)
  assert.ok(x.calls.some(call => call[0] === 'top' && call[1] === true))
  assert.ok(x.calls.some(call => call[0] === 'ignore' && call[1] === true))
})
test('resize RPC reports host bounds errors, reconciles actual bounds, and keeps the queue usable', async t => {
  for (const failure of [
    ['async rejection', () => Promise.reject(new Error('injected async setBounds failure'))],
    ['returned Error', () => new Error('injected returned setBounds error')],
  ]) {
    await t.test(failure[0], async t => {
      const x = fixture(t)
      await x.service.openLyrics()
      const win = x.windows[0], session = new URL(win.url, 'file:///').searchParams.get('session')
      const actual = { x: -900, y: 10, width: 450, height: 100 }
      const originalSetBounds = win.setBounds.bind(win)
      win.setBounds = next => failure[1]()
      win.getBounds = () => actual
      const sendInvoke = (id, params) => x.ipcRenderer.emit(PARENT, { senderId: 42 }, {
        session, kind: 'invoke', id, channel: names.set_win_bounds, params,
      })
      sendInvoke('resize-failure', { x: 10, y: 5, w: 600, h: 120 })
      await new Promise(resolve => setImmediate(resolve))

      const failedReply = x.calls.map(call => call[1]).find(packet => packet?.id === 'resize-failure')
      assert.match(failedReply.error, /injected (async setBounds failure|returned setBounds error)/)
      assert.equal(failedReply.kind, 'result')
      assert.deepEqual(
        Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, x.lx.appSetting[`desktopLyric.${key}`]])),
        { x: actual.x, y: actual.y, width: actual.width, height: actual.height },
      )

      win.setBounds = next => { originalSetBounds(next); return undefined }
      sendInvoke('resize-recovery', { x: 10, y: 5, w: 600, h: 120 })
      await new Promise(resolve => setImmediate(resolve))
      const recoveryReply = x.calls.map(call => call[1]).find(packet => packet?.id === 'resize-recovery')
      assert.equal(recoveryReply.error, undefined)
      assert.equal(recoveryReply.kind, 'result')
    })
  }
})
test('an older failed resize cannot overwrite a newer successful resize', async t => {
  const x = fixture(t)
  await x.service.openLyrics()
  const win = x.windows[0], session = new URL(win.url, 'file:///').searchParams.get('session')
  const originalGetBounds = win.getBounds.bind(win), staleBounds = { ...originalGetBounds() }
  let reads = 0, attempts = 0
  win.getBounds = () => {
    reads++
    if (reads === 3) return new Promise(resolve => setImmediate(() => resolve(staleBounds)))
    return originalGetBounds()
  }
  win.setBounds = next => {
    attempts++
    if (attempts === 1) return Promise.reject(new Error('first resize failed'))
    win.bounds = next
  }
  const sendInvoke = (id, width) => x.ipcRenderer.emit(PARENT, { senderId: 42 }, {
    session, kind: 'invoke', id, channel: names.set_win_bounds, params: { x: 0, y: 0, w: width, h: 120 },
  })

  sendInvoke('resize-old-failure', 600)
  sendInvoke('resize-new-success', 700)
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))

  const replies = new Map(x.calls.map(call => call[1]).filter(packet => packet?.id).map(packet => [packet.id, packet]))
  assert.match(replies.get('resize-old-failure')?.error, /first resize failed/)
  assert.equal(replies.get('resize-new-success')?.error, undefined)
  assert.equal(win.bounds.width, 700)
  assert.equal(x.lx.appSetting['desktopLyric.width'], 700)

  sendInvoke('resize-after-overlap', 800)
  await new Promise(resolve => setImmediate(resolve))
  const laterReply = x.calls.map(call => call[1]).find(packet => packet?.id === 'resize-after-overlap')
  assert.equal(laterReply.error, undefined)
  assert.equal(win.bounds.width, 800)
  assert.equal(x.lx.appSetting['desktopLyric.width'], 800)
})

function capturePoll(t) {
  let tick
  t.mock.method(global, 'setInterval', callback => { tick = callback; return { unref() {} } })
  return () => tick()
}
const turn = () => new Promise(resolve => setImmediate(resolve))

test('an older bounds poll cannot roll back a successful resize RPC', async t => {
  const tick = capturePoll(t), x = fixture(t)
  await x.service.openLyrics()
  const win = x.windows[0], session = new URL(win.url, 'file:///').searchParams.get('session')
  const old = { ...win.bounds }, get = win.getBounds.bind(win)
  let release, reads = 0
  win.getBounds = () => ++reads === 1 ? new Promise(resolve => { release = () => resolve(old) }) : get()
  tick(); await turn()
  x.ipcRenderer.emit(PARENT, { senderId: 42 }, { session, kind: 'invoke', id: 'resize-during-poll', channel: names.set_win_bounds, params: { x: 0, y: 0, w: 700, h: 120 } })
  await turn()
  assert.equal(x.calls.map(call => call[1]).find(packet => packet?.id === 'resize-during-poll')?.error, undefined)
  assert.equal(win.bounds.width, 700)
  release(); await turn(); await turn()
  assert.equal(x.lx.appSetting['desktopLyric.width'], 700)
  assert.equal(win.bounds.width, 700)
})

test('bounds polling coalesces ticks and skips reads during pending host operations', async t => {
  const tick = capturePoll(t), x = fixture(t)
  await x.service.openLyrics()
  const win = x.windows[0], get = win.getBounds.bind(win)
  let release, reads = 0
  win.getBounds = () => { reads++; return new Promise(resolve => { release = () => resolve({ ...get(), width: 610 }) }) }
  tick(); await turn(); tick(); tick(); await turn()
  assert.equal(reads, 1, 'overlapping poll RPCs must coalesce instead of completing out of order')
  release(); await turn(); await turn()
  assert.equal(x.lx.appSetting['desktopLyric.width'], 610)
  win.getBounds = get
  const set = win.setBounds.bind(win)
  let complete
  win.setBounds = bounds => new Promise(resolve => { complete = () => { set(bounds); resolve() } })
  x.lx.event_app.update_config({ 'desktopLyric.width': 720 })
  await turn(); tick(); await turn()
  assert.equal(x.lx.appSetting['desktopLyric.width'], 720, 'poll must not publish pre-operation bounds while setBounds is pending')
  complete(); await turn()
})

for (const action of ['closeLyrics', 'dispose']) test(`pending bounds poll cannot mutate settings after ${action}`, async t => {
  const tick = capturePoll(t), x = fixture(t)
  await x.service.openLyrics()
  const win = x.windows[0], oldWidth = x.lx.appSetting['desktopLyric.width']
  let release
  win.getBounds = () => new Promise(resolve => { release = () => resolve({ ...win.bounds, width: 810 }) })
  tick(); await turn()
  await x.service[action]()
  release(); await turn(); await turn()
  assert.equal(x.lx.appSetting['desktopLyric.width'], oldWidth)
  assert.equal(x.service.getStatus().open, false)
  assert.equal(win.dead, true)
})

test('a replacement lyric window can poll while an obsolete window read is still pending', async t => {
  const tick = capturePoll(t), x = fixture(t)
  await x.service.openLyrics()
  const old = x.windows[0]
  let release
  old.getBounds = () => new Promise(resolve => { release = () => resolve({ ...old.bounds, width: 810 }) })
  tick(); await turn(); await x.service.closeLyrics(); await x.service.openLyrics()
  const current = x.windows[1]
  current.bounds = { ...current.bounds, width: 620 }
  tick(); await turn(); await turn()
  assert.equal(x.lx.appSetting['desktopLyric.width'], 620)
  release(); await turn(); await turn()
  assert.equal(x.lx.appSetting['desktopLyric.width'], 620)
  assert.equal(current.bounds.width, 620)
})
