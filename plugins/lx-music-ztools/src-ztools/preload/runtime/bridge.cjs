const { EventEmitter } = require('node:events')

/** Dispatch only explicitly registered LX business channels. */
function createBridge(handlers = {}) {
  const table = new Map(Object.entries(handlers))
  const events = new EventEmitter()
  const snapshots = new Map()
  let disposed = false
  const error = (code, message) => Object.assign(new Error(message), { code })
  const bridge = {
    async invoke(channel, params) {
      if (disposed) throw error('DISPOSED', '插件服务已终止')
      if (!table.has(channel)) throw error('UNKNOWN_CHANNEL', `未适配的业务通道：${channel}`)
      return table.get(channel)(params)
    },
    send(channel, params) { void bridge.invoke(channel, params).catch(cause => events.emit('bridge:error', { channel, code: cause.code, message: cause.message })) },
    register(channel, handler) {
      if (table.has(channel)) throw error('DUPLICATE_CHANNEL', `重复业务通道：${channel}`)
      table.set(channel, handler)
    },
    setSnapshot(key, value) { snapshots.set(key, structuredClone(value)) },
    readSnapshot(key) {
      if (!snapshots.has(key)) throw error('SNAPSHOT_UNREADY', `同步快照未准备：${key}`)
      return structuredClone(snapshots.get(key))
    },
    on(channel, listener) { events.on(channel, listener) },
    once(channel, listener) { events.once(channel, listener) },
    off(channel, listener) { events.off(channel, listener) },
    offAll(channel) { events.removeAllListeners(channel) },
    subscribe(channel, listener) { events.on(channel, listener); return () => events.off(channel, listener) },
    emit(channel, params) { if (!disposed) events.emit(channel, params) },
    async dispose() { disposed = true; events.removeAllListeners(); table.clear(); snapshots.clear() },
  }
  return bridge
}
module.exports = { createBridge }
