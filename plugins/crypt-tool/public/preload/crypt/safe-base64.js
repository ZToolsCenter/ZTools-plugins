const { ok, fail, tryCrypt } = require('./envelope')

function urlSafeBase64Encode({ input, stripPadding }) {
  return tryCrypt(() => {
    const buf = Buffer.from(String(input), 'utf-8')
    let b64 = buf.toString('base64')
    b64 = b64.replace(/\+/g, '-').replace(/\//g, '_')
    if (stripPadding) {
      b64 = b64.replace(/=+$/, '')
    }
    return ok(b64)
  })
}

function urlSafeBase64Decode({ input }) {
  return tryCrypt(() => {
    let b64 = String(input).replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4
    if (pad) {
      b64 += '='.repeat(4 - pad)
    }
    const buf = Buffer.from(b64, 'base64')
    return ok(buf.toString('utf-8'))
  })
}

module.exports = { urlSafeBase64Encode, urlSafeBase64Decode }
