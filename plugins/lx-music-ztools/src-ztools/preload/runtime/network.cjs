const { randomUUID } = require('node:crypto')
const original = require('../upstream/renderer/utils/request.cjs')
// Load needle and its encoding tables while preload still owns the Node realm.
require('./encodings.cjs')
const needle = require('needle')
const { httpOverHttp, httpsOverHttp } = require('tunnel')
const { proxy } = require('./proxy.cjs')

function sourceFetch(url, { method = 'get', timeout, headers, body, form, formData }) {
  const options = { headers, response_timeout: typeof timeout === 'number' && timeout > 0 ? Math.min(timeout, 60000) : 60000 }
  if (proxy.enable && proxy.host) options.agent = (/^https:/.test(url) ? httpsOverHttp : httpOverHttp)({ proxy: { host: proxy.host, port: proxy.port } })
  let data
  if (body) data = body
  else if (form) { data = form; options.json = false }
  else if (formData) { data = formData; options.json = false }
  let request
  const promise = new Promise((resolve, reject) => {
    request = needle.request(method, url, data, options, (error, response) => {
      if (error) { reject(error); return }
      let body = response.raw.toString()
      try { body = JSON.parse(body) } catch {}
      resolve({ statusCode: response.statusCode, statusMessage: response.statusMessage,
        headers: response.headers, bytes: response.bytes, raw: response.raw, body })
    }).request
  })
  return { promise, cancelHttp() { if (request && !request.aborted) request.abort() } }
}

/** Maintain scoped, cancellable LX HTTP requests with serializable responses. */
function createNetwork() {
  const pending = new Map()
  const start = (fetch, { url, id = randomUUID(), ...options }) => {
    let parsed
    try { parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP(S) URLs are supported') }
    catch (error) { return { id, result: Promise.reject(error), cancel() {} } }
    if (pending.has(id) || pending.size >= 64) return { id, result: Promise.reject(new Error('HTTP request limit reached')), cancel() {} }
    let rejectRequest, request, cancelled = false
    const result = new Promise((resolve, reject) => {
      rejectRequest = reject
      request = fetch(parsed.href, options)
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
  }
  return {
    request: input => start((url, options) => original.httpFetch(url, { ...options, method: options.method || 'get', timeout: Math.min(options.timeout || 60000, 60000) }), input),
    requestSource: input => start(sourceFetch, input),
    cancel(id) { pending.get(id)?.() },
    inspect: () => ({ pending: pending.size }),
    dispose() { for (const cancel of pending.values()) cancel(); pending.clear() },
  }
}
module.exports = { createNetwork }
