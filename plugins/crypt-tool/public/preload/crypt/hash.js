const crypto = require('node:crypto')
const { ok, tryCrypt } = require('./envelope')

function digest(algo, input) {
  return tryCrypt(() =>
    ok(crypto.createHash(algo).update(String(input), 'utf-8').digest('hex'))
  )
}

module.exports = {
  md5: { digest: (input) => digest('md5', input) },
  sha256: { digest: (input) => digest('sha256', input) }
}
