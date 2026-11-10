import { tools } from './source-tools'
import { Buffer } from 'buffer'
import protocol from '../src-ztools/preload/runtime/source/protocol.cjs'

// Only this Worker evaluates user code. CSP denies raw network, files and nested workers.
const reply = globalThis.postMessage.bind(globalThis)
const callbacks = new Map()
let initialized = false, started = false, alertSent = false, requestHandler, nextHttpId = 0
const EVENT_NAMES = Object.freeze({ request: 'request', inited: 'inited', updateAlert: 'updateAlert' })
function createAPI(info) {
  const lx = {
    EVENT_NAMES, version: '2.0.0', env: 'desktop', utils: tools,
    currentScriptInfo: { name: info.name, description: info.description, version: info.version, author: info.author, homepage: info.homepage, rawScript: info.script },
    on(event, handler) {
      if (event !== 'request' || typeof handler !== 'function') return Promise.reject(new Error('The event is not supported: ' + event))
      requestHandler = handler
      return Promise.resolve()
    },
    async send(event, data) {
      if (event === 'inited') {
        if (initialized) throw new Error('Script is inited')
        const sources = protocol.normalizeSources(data?.sources)
        initialized = true
        reply({ type: 'inited', sources })
      } else if (event === 'updateAlert') {
        if (alertSent) throw new Error('The update alert can only be called once.')
        if (!data || typeof data.log !== 'string' || !data.log) throw new Error('log is required.')
        alertSent = true
        reply({ type: 'updateAlert', data: { log: data.log.slice(0, 1024), updateUrl: /^https?:\/\//.test(data.updateUrl) ? data.updateUrl.slice(0, 1024) : undefined } })
      } else throw new Error('The event is not supported: ' + event)
    },
    request(url, options = {}, callback) {
      if (typeof callback !== 'function') throw new TypeError('HTTP callback is required')
      const id = String(++nextHttpId)
      callbacks.set(id, callback)
      reply({ type: 'http', id, url, options })
      return () => { if (!callbacks.has(id)) return; callbacks.delete(id); reply({ type: 'http-cancel', id }) }
    },
  }
  return Object.freeze(lx)
}
globalThis.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      if (started) return
      started = true
      Object.defineProperty(globalThis, 'lx', { value: createAPI(data.info), writable: false, configurable: false })
      ;(0, eval)(data.info.script)
    } else if (data.type === 'http-response') {
      const callback = callbacks.get(data.id)
      if (!callback) return
      callbacks.delete(data.id)
      if (data.error) callback.call(lx, new Error(data.error), null, null)
      else { data.response.raw = Buffer.from(data.response.raw); callback.call(lx, null, data.response, data.response.body) }
    } else if (data.type === 'request') {
      if (!initialized || !requestHandler) throw new Error('Request event is not defined')
      try {
        const response = await requestHandler.call(lx, data.input.data)
        reply({ type: 'response', requestKey: data.input.requestKey, result: protocol.normalizeResult(data.input.data, response) })
      } catch (error) { reply({ type: 'response', requestKey: data.input.requestKey, error: String(error.message || error) }) }
    }
  } catch (error) { reply({ type: initialized ? 'error' : 'init-error', error: String(error.message || error) }) }
}
globalThis.addEventListener('unhandledrejection', event => { if (!initialized) reply({ type: 'init-error', error: String(event.reason?.message || event.reason) }) })
