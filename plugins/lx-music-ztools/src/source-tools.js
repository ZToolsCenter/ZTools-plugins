import crypto from 'crypto-browserify'
import { Buffer } from 'buffer'
import { inflate, deflate } from 'pako'

export const tools = {
  crypto: {
    md5: value => crypto.createHash('md5').update(value).digest('hex'),
    aesEncrypt(buffer, mode, key, iv) {
      const cipher = crypto.createCipheriv(mode, key, iv)
      return Buffer.concat([cipher.update(buffer), cipher.final()])
    },
    rsaEncrypt(buffer, key) {
      buffer = Buffer.concat([Buffer.alloc(128 - buffer.length), buffer])
      return crypto.publicEncrypt({ key, padding: 3 }, buffer)
    },
    randomBytes: size => crypto.randomBytes(size),
  },
  buffer: { from: (...args) => Buffer.from(...args), bufToString: (buf, format) => Buffer.from(buf, 'binary').toString(format) },
  zlib: { inflate: async buf => Buffer.from(inflate(buf)), deflate: async buf => Buffer.from(deflate(buf)) },
}
