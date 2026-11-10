import './contracts'
import { Buffer } from 'buffer'
export function httpFetch(url: string, options: any = {}) {
  const id = crypto.randomUUID()
  const cancelHttp = () => window.lxHost.send('network:cancel', id)
  const promise = window.lxHost.invoke<any>('network:fetch', { ...options, id, url }).then(response => ({ ...response, raw: Buffer.from(response.raw) }))
  return { promise, cancelHttp, abort: cancelHttp }
}
export const cancelHttp = request => request?.cancelHttp ? request.cancelHttp() : request?.abort?.()
export function http(url, options, callback) {
  if (typeof options === 'function') { callback = options; options = {} }
  const request = httpFetch(url, options)
  request.promise.then(response => callback(null, response, response.body), error => callback(error, null, null))
  return request
}
export const httpGet = (url, options, callback?) => http(url, options, callback)
export const httpPost = (url, data, options, callback?) => {
  if (typeof options === 'function') { callback = options; options = {} }
  return http(url, { ...options, method: 'post', body: data }, callback)
}
export const http_jsonp = (url, options, callback) => {
  const callbackName = 'jsonpCallback'
  return http(`${url}${url.includes('?') ? '&' : '?'}${options.jsonpCallback}=${callbackName}`, { ...options, format: 'script' }, (error, response, body) => {
    if (error) return callback(error, response, body)
    try { callback(null, response, JSON.parse(body.replace(/^jsonpCallback\(({.*})\)$/, '$1'))) }
    catch (cause) { callback(cause, response, null) }
  })
}
export const checkUrl = async (url, options = {}) => { const response = await httpFetch(url, { ...options, method: 'head' }).promise; if (response.statusCode !== 200) throw new Error(String(response.statusCode)) }
