const { randomUUID } = require('node:crypto')
const original = require('../upstream/renderer/utils/request.cjs')

/** Maintain scoped, cancellable LX HTTP requests with serializable responses. */
function createNetwork() {
  const pending = new Map()
  return {
    request({ url, id = randomUUID(), ...options }) {
      let parsed
      try { parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP(S) URLs are supported') }
      catch (error) { return { id, result: Promise.reject(error), cancel() {} } }
      if (pending.has(id) || pending.size >= 64) return { id, result: Promise.reject(new Error('HTTP request limit reached')), cancel() {} }
      let rejectRequest, request, cancelled = false
      const result = new Promise((resolve, reject) => {
        rejectRequest = reject
        request = original.httpFetch(parsed.href, { ...options, method: options.method || 'get', timeout: Math.min(options.timeout || 60000, 60000) })
        request.promise.then(response => {
          if (cancelled) return
          resolve({ statusCode: response.statusCode, statusMessage: response.statusMessage,
            headers: response.headers, raw: Buffer.from(response.raw || []), bytes: response.bytes,
            body: response.body })
        }, reject)
      }).finally(() => pending.delete(id))
      const cancel = () => { if (cancelled) return; cancelled = true; request?.cancelHttp(); rejectRequest(Object.assign(new Error('取消http请求'), { code: 'CANCELLED' })) }
      pending.set(id, cancel)
      return { id, result, cancel }
    },
    cancel(id) { pending.get(id)?.() },
    dispose() { for (const cancel of pending.values()) cancel(); pending.clear() },
  }
}
module.exports = { createNetwork }
