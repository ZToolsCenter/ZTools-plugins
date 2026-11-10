import * as pako from 'pako'
import { Buffer } from 'buffer'
export const constants = { Z_SYNC_FLUSH: 2 }
function callback(method: string, data: any, options: any, cb?: Function) {
  if (typeof options === 'function') { cb = options; options = undefined }
  try { const result = Buffer.from(pako[method](data, options)); queueMicrotask(() => cb(null, result)) }
  catch (error) { queueMicrotask(() => cb(error)) }
}
export const inflate = (data, options, cb?) => callback('inflate', data, options, cb)
export const deflate = (data, options, cb?) => callback('deflate', data, options, cb)
export const deflateRaw = (data, options, cb?) => callback('deflateRaw', data, options, cb)
export const gzip = (data, options, cb?) => callback('gzip', data, options, cb)
export const gunzip = (data, options, cb?) => callback('ungzip', data, options, cb)
