import { tools } from './source-tools'
import { Buffer } from 'buffer'
const reply = globalThis.postMessage.bind(globalThis)
globalThis.onmessage = async ({ data }) => {
  if (data.type === 'busy') { while (true) {} }
  if (data.type !== 'probe') return
  try {
    reply({ type: 'probe-result', result: {
      node: typeof globalThis.require, ztools: typeof globalThis.ztools,
      syncMd5: tools.crypto.md5('abc'), origin: globalThis.origin,
      hostFileReadable: await fetch('file:///C:/Windows/win.ini').then(() => true, () => false),
      networkReadable: await fetch(data.url).then(() => true, () => false),
      aes: tools.buffer.bufToString(tools.crypto.aesEncrypt(Buffer.from('test'), 'aes-128-cbc', Buffer.alloc(16), Buffer.alloc(16)), 'hex'),
      compressed: tools.buffer.bufToString(await tools.zlib.inflate(await tools.zlib.deflate(Buffer.from('中文'))), 'utf8'),
      rsa: tools.buffer.bufToString(tools.crypto.rsaEncrypt(Buffer.from('abc'), data.publicKey), 'hex'),
    } })
  } catch (error) { reply({ type: 'error', error: error.message }) }
}
