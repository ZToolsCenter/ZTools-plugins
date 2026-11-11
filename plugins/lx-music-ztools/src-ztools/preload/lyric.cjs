const { ipcRenderer } = require('electron')
const { EventEmitter } = require('node:events')
const { randomUUID } = require('node:crypto')
const { PARENT, CHILD } = require('./runtime/windows.cjs')
// ZTools may evaluate this preload while location is still about:blank.
const getSession = () => new URL(window.location.href).searchParams.get('session')
const events = new EventEmitter(), pending = new Map()
function invoke(channel, params) {
  const session = getSession()
  const id = randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('歌词主窗口请求超时')) }, 15000)
    pending.set(id, { resolve, reject, timer })
    try { window.ztools.sendToParent(PARENT, { session, kind: 'invoke', id, channel, params }) }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error) }
  })
}
ipcRenderer.on(CHILD, (_event, packet) => {
  if (packet?.session !== getSession()) return
  if (packet.kind === 'event') events.emit(packet.channel, packet.params)
  else if (packet.kind === 'result') {
    const request = pending.get(packet.id)
    if (!request) return
    pending.delete(packet.id); clearTimeout(request.timer)
    packet.error ? request.reject(new Error(packet.error)) : request.resolve(packet.result)
  }
})
window.lxHost = {
  invoke, send(channel, params) { void invoke(channel, params).catch(console.error) },
  readSnapshot() { throw new Error('歌词窗口不拥有同步数据快照') },
  on: (channel, listener) => events.on(channel, listener), once: (channel, listener) => events.once(channel, listener),
  off: (channel, listener) => events.off(channel, listener), offAll: channel => events.removeAllListeners(channel),
  subscribe(channel, listener) { events.on(channel, listener); return () => events.off(channel, listener) },
}
window.addEventListener('unload', () => {
  window.ztools.sendToParent(PARENT, { session: getSession(), kind: 'closed' })
  for (const request of pending.values()) clearTimeout(request.timer)
  pending.clear(); events.removeAllListeners()
})
