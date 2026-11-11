const { startWorkerServer } = require('../../worker-server.cjs')
const { normalizeSources, validateRequest, normalizeResult } = require('./protocol.cjs')

/** Own one isolated source, its HTTP requests and every pending playback result. */
class SourceSession {
  constructor({ info, network, onAlert, onFatal }) {
    this.info = info; this.network = network; this.onAlert = onAlert; this.onFatal = onFatal
    this.pending = new Map(); this.http = new Set(); this.closed = false
  }
  async start() {
    this.server = await startWorkerServer()
    if (this.closed) { await this.server.close(); throw new Error('source changed') }
    this.origin = new URL(this.server.url).origin
    const frame = this.frame = document.createElement('iframe')
    frame.style.display = 'none'
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin')
    const initialized = new Promise((resolve, reject) => {
      this.resolveInit = resolve; this.rejectInit = reject
      this.initTimer = setTimeout(() => reject(new Error('音源初始化超时')), 8000)
    })
    this.listener = event => {
      if (this.closed || event.source !== frame.contentWindow || event.origin !== this.origin || event.data?.channel !== this.server.token) return
      this.handle(event.data)
    }
    window.addEventListener('message', this.listener)
    frame.src = this.server.url
    document.body.append(frame)
    try { return await initialized }
    catch (error) { await this.close(error.message); throw error }
    finally { clearTimeout(this.initTimer) }
  }
  send(data) {
    if (!this.closed) this.frame.contentWindow.postMessage({ ...data, channel: this.server.token }, this.origin)
  }
  fail(error) {
    if (this.closed) return
    this.rejectInit?.(error)
    const initialized = Boolean(this.sources)
    void this.close(error.message)
    if (initialized) this.onFatal?.(error)
  }
  handle(message) {
    try {
      if (message.type === 'ready' && !this.initSent) { this.initSent = true; this.send({ type: 'init', info: this.info }) }
      else if (message.type === 'inited' && !this.sources) { this.sources = normalizeSources(message.sources); this.resolveInit(this.sources) }
      else if (message.type === 'init-error') this.rejectInit(new Error(String(message.error).slice(0, 1024)))
      else if (message.type === 'error') this.fail(new Error(String(message.error).slice(0, 1024)))
      else if (message.type === 'http') this.requestHTTP(message)
      else if (message.type === 'http-cancel') this.network.cancel(`${this.server.token}:${message.id}`)
      else if (message.type === 'response') {
        const item = this.pending.get(message.requestKey)
        if (!item) return
        this.pending.delete(message.requestKey); clearTimeout(item.timer)
        if (message.error) item.reject(new Error(String(message.error).slice(0, 1024)))
        else {
          // Revalidate outside untrusted code, using the original requested action.
          const raw = item.input.data.action === 'musicUrl' ? message.result?.data?.url : message.result?.data
          try { item.resolve(normalizeResult(item.input.data, raw)) } catch (error) { item.reject(error) }
        }
      } else if (message.type === 'updateAlert' && typeof message.data?.log === 'string') this.onAlert?.({ log: message.data.log.slice(0, 1024), updateUrl: /^https?:\/\//.test(message.data.updateUrl) ? message.data.updateUrl.slice(0, 1024) : undefined })
    } catch (error) { this.fail(error) }
  }
  requestHTTP(message) {
    if (typeof message.id !== 'string' || message.id.length > 100) return
    if (this.http.size >= 32) { this.send({ type: 'http-response', id: message.id, error: '音源并发 HTTP 请求超过限制' }); return }
    const id = `${this.server.token}:${message.id}`
    if (this.http.has(id)) return
    const options = message.options && typeof message.options === 'object' ? message.options : {}
    const safe = Object.fromEntries(['method', 'headers', 'body', 'form', 'formData', 'timeout'].filter(key => Object.hasOwn(options, key)).map(key => [key, options[key]]))
    for (const path of Array.isArray(message.bufferPaths) ? message.bufferPaths : []) {
      if (!Array.isArray(path) || !['body', 'form', 'formData'].includes(path[0]) || path.some(key => typeof key !== 'string')) continue
      let owner = safe
      for (const key of path.slice(0, -1)) owner = owner && Object.hasOwn(owner, key) ? owner[key] : null
      const key = path.at(-1), value = owner && Object.hasOwn(owner, key) ? owner[key] : null
      if (ArrayBuffer.isView(value)) owner[key] = Buffer.from(value.buffer, value.byteOffset, value.byteLength)
    }
    const request = this.network.requestSource({ ...safe, url: message.url, id })
    this.http.add(id)
    request.result.then(response => this.send({ type: 'http-response', id: message.id, response }), error => this.send({ type: 'http-response', id: message.id, error: error.message })).finally(() => this.http.delete(id))
  }
  request(input) {
    if (this.closed || !this.sources) return Promise.reject(new Error('音源尚未就绪'))
    try { validateRequest(this.sources, input?.data) } catch (error) { return Promise.reject(error) }
    if (typeof input.requestKey !== 'string' || !input.requestKey || input.requestKey.length > 512 || this.pending.has(input.requestKey)) return Promise.reject(new Error('无效或重复的音源请求 ID'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(input.requestKey)
        const error = Object.assign(new Error('音源请求超时，请重新启用或更换音源'), { code: 'SOURCE_TIMEOUT' })
        reject(error); this.fail(error)
      }, 30000)
      this.pending.set(input.requestKey, { input, timer, resolve, reject })
      this.send({ type: 'request', input })
    })
  }
  cancel(requestKey) {
    const item = this.pending.get(requestKey)
    if (!item) return
    this.pending.delete(requestKey); clearTimeout(item.timer); item.reject(new Error('取消音源请求'))
  }
  async close(reason = 'source changed / 音源已切换') {
    if (this.closed) return
    this.closed = true
    clearTimeout(this.initTimer); this.rejectInit?.(new Error(reason))
    for (const key of [...this.pending.keys()]) this.cancel(key)
    for (const id of this.http) this.network.cancel(id)
    this.http.clear()
    if (this.listener) window.removeEventListener('message', this.listener)
    if (this.frame) {
      this.frame.contentWindow?.postMessage({ channel: this.server.token, type: 'dispose' }, this.origin)
      this.frame.remove()
    }
    await this.server?.close()
  }
}
module.exports = { SourceSession }
