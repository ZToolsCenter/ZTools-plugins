const crypto = require('node:crypto')
const { ok, tryCrypt } = require('./envelope')

function digest(algo, input) {
  return tryCrypt(() =>
    ok(crypto.createHash(algo).update(String(input), 'utf-8').digest('hex'))
  )
}

module.exports = {
  md5: { digest: (input) => digest('md5', input) },
  sha1: { digest: (input) => digest('sha1', input) },
  sha256: { digest: (input) => digest('sha256', input) },
  sha384: { digest: (input) => digest('sha384', input) },
  sha512: { digest: (input) => digest('sha512', input) },
  sha3_256: { digest: (input) => digest('sha3-256', input) },
  sha3_512: { digest: (input) => digest('sha3-512', input) },
  ripemd160: { digest: (input) => digest('ripemd160', input) }
}
