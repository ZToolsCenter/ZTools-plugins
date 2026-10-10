const crypto = require('node:crypto')
const { ok, fail, tryCrypt } = require('./envelope')

const uuid = {
  v4() {
    return tryCrypt(() => ok(crypto.randomUUID()))
  },
  v7() {
    return tryCrypt(() => {
      const now = Date.now()
      const timeHex = now.toString(16).padStart(12, '0')
      const randBytes = crypto.randomBytes(10)
      const timeArray = new Uint8Array(6)
      for (let i = 0; i < 6; i++) {
        timeArray[i] = parseInt(timeHex.substring(i * 2, i * 2 + 2), 16)
      }
      randBytes[0] = (randBytes[0] & 0x0f) | 0x70
      randBytes[2] = (randBytes[2] & 0x3f) | 0x80
      const bytes = new Uint8Array([...timeArray, ...randBytes])
      const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
      return ok(
        `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`
      )
    })
  },
  generate({ version, count }) {
    return tryCrypt(() => {
      const ver = version ?? 'v4'
      const n = Math.max(1, Math.min(Number(count) || 1, 100))
      const results = []
      for (let i = 0; i < n; i++) {
        results.push(ver === 'v7' ? uuid.v7().data : uuid.v4().data)
      }
      return ok(results.join('\n'))
    })
  }
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function base58Encode({ input }) {
  return tryCrypt(() => {
    const buf = Buffer.from(String(input), 'utf-8')
    if (buf.length === 0) return ok('')
    let num = BigInt('0x' + buf.toString('hex'))
    let encoded = ''
    const base = BigInt(58)
    while (num > 0) {
      encoded = BASE58_ALPHABET[Number(num % base)] + encoded
      num = num / base
    }
    let leading = 0
    for (const b of buf) {
      if (b === 0) leading++
      else break
    }
    return ok('1'.repeat(leading) + encoded)
  })
}

function base58Decode({ input }) {
  return tryCrypt(() => {
    const s = String(input).trim()
    if (!s) return ok('')
    if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(s)) {
      return fail('Base58 字符无效')
    }
    let num = BigInt(0)
    const base = BigInt(58)
    for (const ch of s) {
      num = num * base + BigInt(BASE58_ALPHABET.indexOf(ch))
    }
    let leading = 0
    for (const ch of s) {
      if (ch === '1') leading++
      else break
    }
    const hex = num.toString(16)
    const padded = hex.length % 2 === 0 ? hex : '0' + hex
    const buf = Buffer.from('00'.repeat(leading) + padded, 'hex')
    return ok(buf.toString('utf-8'))
  })
}

function base58CheckEncode({ input }) {
  return tryCrypt(() => {
    const hexStr = String(input).trim().replace(/\s+/g, '')
    if (!/^[0-9a-fA-F]*$/.test(hexStr) || hexStr.length % 2 !== 0) {
      return fail('请输入偶数位的 Hex 字符串')
    }
    const buf = Buffer.from(hexStr, 'hex')
    const hash1 = crypto.createHash('sha256').update(buf).digest()
    const hash2 = crypto.createHash('sha256').update(hash1).digest()
    const checksum = hash2.subarray(0, 4)
    const payload = Buffer.concat([buf, checksum])
    let num = BigInt('0x' + payload.toString('hex'))
    let encoded = ''
    const base = BigInt(58)
    while (num > 0) {
      encoded = BASE58_ALPHABET[Number(num % base)] + encoded
      num = num / base
    }
    let leading = 0
    for (const b of payload) {
      if (b === 0) leading++
      else break
    }
    return ok('1'.repeat(leading) + encoded)
  })
}

function base58CheckDecode({ input }) {
  return tryCrypt(() => {
    const s = String(input).trim()
    if (!s) return ok({ valid: false, data: '' })
    if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(s)) {
      return ok({ valid: false, data: '' })
    }
    let num = BigInt(0)
    const base = BigInt(58)
    for (const ch of s) {
      num = num * base + BigInt(BASE58_ALPHABET.indexOf(ch))
    }
    let leading = 0
    for (const ch of s) {
      if (ch === '1') leading++
      else break
    }
    const hex = num.toString(16)
    const padded = hex.length % 2 === 0 ? hex : '0' + hex
    const fullHex = '00'.repeat(leading) + padded
    const payload = Buffer.from(fullHex, 'hex')
    if (payload.length < 5) return ok({ valid: false, data: '' })
    const data = payload.subarray(0, payload.length - 4)
    const checksum = payload.subarray(payload.length - 4)
    const hash1 = crypto.createHash('sha256').update(data).digest()
    const hash2 = crypto.createHash('sha256').update(hash1).digest()
    const expected = hash2.subarray(0, 4)
    const valid = checksum.equals(expected)
    return ok({ valid, data: data.toString('hex') })
  })
}

const crc32 = {
  checksum({ input }) {
    return tryCrypt(() => {
      const buf = Buffer.from(String(input), 'utf-8')
      let crc = 0xFFFFFFFF
      const table = getCRC32Table()
      for (let i = 0; i < buf.length; i++) {
        const byte = buf[i]
        crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xFF]
      }
      crc = (crc ^ 0xFFFFFFFF) >>> 0
      return ok(crc.toString(16).padStart(8, '0'))
    })
  }
}

let crcTable = null
function getCRC32Table() {
  if (crcTable) return crcTable
  crcTable = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    }
    crcTable[i] = c >>> 0
  }
  return crcTable
}

module.exports = {
  uuid,
  base58: { encode: base58Encode, decode: base58Decode },
  base58check: { encode: base58CheckEncode, decode: base58CheckDecode },
  crc32
}
