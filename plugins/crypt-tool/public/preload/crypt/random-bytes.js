const crypto = require('node:crypto')
const { ok, fail, tryCrypt } = require('./envelope')

function generate({ length, encoding }) {
  return tryCrypt(() => {
    const len = length ?? 32
    if (!Number.isInteger(len) || len < 1 || len > 4096) {
      return fail('长度必须为 1-4096 整数')
    }
    const buf = crypto.randomBytes(len)
    const enc = encoding ?? 'hex'
    if (enc === 'base64') return ok(buf.toString('base64'))
    if (enc === 'base64url') return ok(buf.toString('base64url'))
    return ok(buf.toString('hex'))
  })
}

module.exports = { generate }
