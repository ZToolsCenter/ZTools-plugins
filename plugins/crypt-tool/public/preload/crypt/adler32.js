const { ok, tryCrypt } = require('./envelope')

const MOD_ADLER = 65521

function checksum({ input }) {
  return tryCrypt(() => {
    const buf = Buffer.from(String(input), 'utf-8')
    let a = 1
    let b = 0
    for (let i = 0; i < buf.length; i++) {
      a = (a + buf[i]) % MOD_ADLER
      b = (b + a) % MOD_ADLER
    }
    const result = ((b << 16) | a) >>> 0
    return ok(result.toString(16).padStart(8, '0'))
  })
}

module.exports = { checksum }
