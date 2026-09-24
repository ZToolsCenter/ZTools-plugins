const { ok, fail, tryCrypt } = require('./envelope')

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const PAD_CHAR = '='

function base32Encode({ input, padding }) {
  return tryCrypt(() => {
    const buf = Buffer.from(String(input), 'utf-8')
    if (buf.length === 0) return ok('')
    let bits = 0
    let value = 0
    let output = ''
    for (let i = 0; i < buf.length; i++) {
      value = (value << 8) | buf[i]
      bits += 8
      while (bits >= 5) {
        bits -= 5
        output += ALPHABET[(value >>> bits) & 0x1F]
      }
    }
    if (bits > 0) {
      output += ALPHABET[(value << (5 - bits)) & 0x1F]
    }
    // Default: apply RFC 4648 padding unless explicitly disabled
    if (padding !== false) {
      while (output.length % 8 !== 0) {
        output += PAD_CHAR
      }
    }
    return ok(output)
  })
}

function base32Decode({ input }) {
  return tryCrypt(() => {
    const str = String(input).replace(/=+$/, '').toUpperCase().replace(/\s+/g, '')
    if (!str) return ok('')
    if (!/^[A-Z2-7]+$/.test(str)) {
      return fail('Base32 字符无效')
    }
    const decodeMap = {}
    for (let i = 0; i < ALPHABET.length; i++) {
      decodeMap[ALPHABET[i]] = i
    }
    let bits = 0
    let value = 0
    const bytes = []
    for (let i = 0; i < str.length; i++) {
      const ch = str[i]
      if (decodeMap[ch] === undefined) continue
      value = (value << 5) | decodeMap[ch]
      bits += 5
      if (bits >= 8) {
        bits -= 8
        bytes.push((value >>> bits) & 0xFF)
      }
    }
    return ok(Buffer.from(bytes).toString('utf-8'))
  })
}

module.exports = { base32Encode, base32Decode }
