const http = require('node:http')
const https = require('node:https')
const { randomBytes } = require('node:crypto')
const { pipeline } = require('node:stream/promises')
const tunnel = require('tunnel')
const { proxy } = require('./proxy.cjs')

const currentProxy = () => proxy.enable && proxy.host ? { host: proxy.host, port: Number(proxy.port || 80) } : null
const responseHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'content-encoding']

/** Stream only previously registered media through the plugin's own HTTP proxy. */
function createMediaProxy({ getProxy = currentProxy, timeout = 30000 } = {}) {
  const resources = new Map(), sockets = new Set(), controllers = new Set(), operations = new Set()
  let server, ready, origin, closed = false, disposal
  const stopped = () => new Error('播放代理服务已终止')
  function open(url, method, headers, signal, redirects = 5) {
    return new Promise((resolve, reject) => {
      const address = new URL(url)
      if (!['http:', 'https:'].includes(address.protocol)) { reject(new Error('无效媒体重定向')); return }
      const configured = getProxy()
      const agent = configured?.host ? (address.protocol === 'https:' ? tunnel.httpsOverHttp : tunnel.httpOverHttp)({ proxy: configured }) : undefined
      if (agent) {
        // tunnel's CONNECT request otherwise outlives an aborted target request.
        agent.request = options => http.request({ ...options, signal })
      }
      const request = (address.protocol === 'https:' ? https : http).request(address, { method, headers, signal, agent }, response => {
        response.on('error', () => {})
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.destroy()
          if (!response.headers.location || !redirects) { reject(new Error('媒体重定向失败')); return }
          let next
          try { next = new URL(response.headers.location, address) } catch { reject(new Error('媒体重定向失败')); return }
          open(next.href, method, headers, signal, redirects - 1).then(resolve, reject)
        } else resolve(response)
      })
      request.setTimeout(timeout, () => request.destroy(new Error('媒体请求超时')))
      request.on('error', reject)
      request.end()
    })
  }
  async function handle(req, res) {
    const url = resources.get(req.url?.slice(1))
    if (!url) { res.writeHead(404); res.end(); return }
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Length, Content-Range, ETag, Last-Modified')
    res.setHeader('Cache-Control', 'no-store')
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'Range, If-Range', 'Access-Control-Allow-Private-Network': 'true' }); res.end(); return
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD, OPTIONS' }); res.end(); return }
    const controller = new AbortController()
    const headerTimeout = setTimeout(() => controller.abort(), timeout)
    controllers.add(controller)
    const cancel = () => { if (!res.writableFinished) controller.abort() }
    req.once('aborted', cancel); res.once('close', cancel)
    try {
      const headers = { 'accept-encoding': 'identity' }
      for (const key of ['range', 'if-range', 'if-none-match', 'if-modified-since', 'user-agent', 'accept', 'accept-language']) if (req.headers[key]) headers[key] = req.headers[key]
      const upstream = await open(url, req.method, headers, controller.signal)
      clearTimeout(headerTimeout)
      for (const key of responseHeaders) if (upstream.headers[key] != null) res.setHeader(key, upstream.headers[key])
      res.writeHead(upstream.statusCode || 502)
      if (req.method === 'HEAD') { upstream.destroy(); res.end() }
      else await pipeline(upstream, res, { signal: controller.signal })
    } catch {
      // Never expose/log signed source URLs or proxy connection details.
      if (!res.destroyed && !res.headersSent) { res.writeHead(502); res.end('媒体代理请求失败') }
      else if (!res.destroyed) res.destroy()
    } finally { clearTimeout(headerTimeout); controllers.delete(controller); req.off('aborted', cancel); res.off('close', cancel) }
  }
  async function ensureServer() {
    if (!ready) {
      server = http.createServer((req, res) => {
        const operation = handle(req, res)
        operations.add(operation); operation.finally(() => operations.delete(operation)).catch(() => {})
      })
      server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
      ready = new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => { origin = `http://127.0.0.1:${server.address().port}`; resolve() })
      })
    }
    await ready
    if (closed) throw stopped()
    return origin
  }
  return {
    async resource(url) {
      if (closed) throw stopped()
      if (typeof url !== 'string') throw new TypeError('无效媒体地址')
      if (!/^https?:/i.test(url) || !getProxy()?.host) return url
      let address
      try { address = new URL(url) } catch { throw new Error('无效媒体地址') }
      if (!['http:', 'https:'].includes(address.protocol)) throw new Error('无效媒体地址')
      const base = await ensureServer()
      for (const [token, resource] of resources) if (resource === address.href) return `${base}/${token}`
      if (resources.size >= 64) resources.delete(resources.keys().next().value)
      const token = randomBytes(24).toString('hex')
      resources.set(token, address.href)
      return `${base}/${token}`
    },
    dispose() {
      closed = true
      return disposal ||= (async () => {
        await ready?.catch(() => {})
        for (const controller of controllers) controller.abort()
        for (const socket of sockets) socket.destroy()
        if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
        await Promise.allSettled([...operations])
        resources.clear(); sockets.clear()
      })()
    },
  }
}
module.exports = { createMediaProxy }
