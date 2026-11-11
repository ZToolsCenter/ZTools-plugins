const original = require('../upstream/main/modules/openApi/index.cjs')

/** Serialize ownership of the original LX HTTP/SSE server and preserve its wire protocol. */
function createOpenAPI() {
  let queue = Promise.resolve(), key, disposed = false
  let status = { status: false, message: '', address: '' }
  const snapshot = () => structuredClone(status)
  const serial = operation => { const result = queue.then(operation, operation); queue = result.catch(() => {}); return result }
  const stop = () => serial(async () => {
    await original.stopServer(); key = null
    status = { status: false, message: '', address: '' }; return snapshot()
  })
  return {
    getStatus: snapshot,
    start(config) {
      return serial(async () => {
        if (disposed) throw new Error('开放 API 已终止')
        const port = Number(config?.port)
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          await original.stopServer(); key = null
          status = { status: false, message: '无效的开放 API 端口（1—65535）', address: '' }; return snapshot()
        }
        const nextKey = `${port}:${Boolean(config.bindLan)}`
        if (status.status && key === nextKey) return snapshot()
        await original.stopServer()
        status = structuredClone(await original.startServer(port, Boolean(config.bindLan)))
        key = status.status ? nextKey : null
        if (!status.status) await original.stopServer() // Failed starts must not retain status subscribers.
        return snapshot()
      })
    },
    stop,
    async dispose() { disposed = true; await stop() },
  }
}
module.exports = { createOpenAPI }
