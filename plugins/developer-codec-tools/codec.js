const UTF8_ENCODER = new TextEncoder()
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: false })

const SHA_ALGORITHMS = new Set(['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'])

export function textToBytes(text) {
  return UTF8_ENCODER.encode(String(text ?? ''))
}

export function bytesToText(bytes) {
  return UTF8_DECODER.decode(toUint8Array(bytes))
}

export function bytesToHex(bytes) {
  return Array.from(toUint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function hexToBytes(input) {
  const clean = String(input ?? '')
    .replace(/0x/gi, '')
    .replace(/[\s:_-]/g, '')
  if (!clean) return new Uint8Array()
  if (!/^[0-9a-f]+$/i.test(clean)) {
    throw new Error('Hex 输入包含非十六进制字符')
  }
  if (clean.length % 2 !== 0) {
    throw new Error('Hex 输入长度必须为偶数')
  }
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = Number.parseInt(clean.slice(i, i + 2), 16)
  }
  return bytes
}

export function bytesToBinary(bytes) {
  return Array.from(toUint8Array(bytes), (byte) => byte.toString(2).padStart(8, '0')).join(' ')
}

export function binaryToBytes(input) {
  const clean = String(input ?? '').replace(/\s+/g, '')
  if (!clean) return new Uint8Array()
  if (!/^[01]+$/.test(clean)) {
    throw new Error('Binary 输入只能包含 0 和 1')
  }
  if (clean.length % 8 !== 0) {
    throw new Error('Binary 输入长度必须是 8 的倍数')
  }
  const bytes = new Uint8Array(clean.length / 8)
  for (let i = 0; i < clean.length; i += 8) {
    bytes[i / 8] = Number.parseInt(clean.slice(i, i + 8), 2)
  }
  return bytes
}

export function bytesToBase64(bytes) {
  const normalized = toUint8Array(bytes)
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(normalized).toString('base64')
  }
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < normalized.length; i += chunkSize) {
    binary += String.fromCharCode(...normalized.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export function base64ToBytes(input) {
  const normalized = normalizeBase64(input)
  if (!normalized) return new Uint8Array()
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error('Base64 输入格式无效')
  }
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(normalized, 'base64'))
  }
  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function base64UrlToBytes(input) {
  return base64ToBytes(String(input ?? '').replace(/-/g, '+').replace(/_/g, '/'))
}

export function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function base64Encode(text) {
  return bytesToBase64(textToBytes(text))
}

export function base64Decode(input) {
  return bytesToText(base64ToBytes(input))
}

export function base64UrlEncode(text) {
  return bytesToBase64Url(textToBytes(text))
}

export function base64UrlDecode(input) {
  return bytesToText(base64UrlToBytes(input))
}

export function urlEncode(input, mode = 'component') {
  const text = String(input ?? '')
  return mode === 'uri' ? encodeURI(text) : encodeURIComponent(text)
}

export function urlDecode(input, mode = 'component') {
  const text = String(input ?? '')
  const normalized = mode === 'form' ? text.replace(/\+/g, ' ') : text
  return mode === 'uri' ? decodeURI(normalized) : decodeURIComponent(normalized)
}

export function htmlEncode(input) {
  return String(input ?? '').replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case "'":
        return '&#39;'
      default:
        return char
    }
  })
}

export function htmlDecode(input) {
  const text = String(input ?? '')
  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea')
    textarea.innerHTML = text
    return textarea.value
  }
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' '
  }
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_entity, body) => {
    const value = String(body)
    if (value[0] === '#') {
      const isHex = value[1]?.toLowerCase() === 'x'
      const codePoint = Number.parseInt(value.slice(isHex ? 2 : 1), isHex ? 16 : 10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _entity
    }
    return Object.prototype.hasOwnProperty.call(named, value.toLowerCase())
      ? named[value.toLowerCase()]
      : _entity
  })
}

export function unicodeEscapeEncode(input, all = false) {
  return Array.from(String(input ?? ''))
    .map((char) => {
      const codePoint = char.codePointAt(0)
      if (!all && codePoint >= 0x20 && codePoint <= 0x7e) return char
      if (codePoint <= 0xffff) return `\\u${codePoint.toString(16).padStart(4, '0')}`
      const high = Math.floor((codePoint - 0x10000) / 0x400) + 0xd800
      const low = ((codePoint - 0x10000) % 0x400) + 0xdc00
      return `\\u${high.toString(16)}\\u${low.toString(16)}`
    })
    .join('')
}

export function unicodeEscapeDecode(input) {
  return String(input ?? '')
    .replace(/\\u\{([0-9a-f]+)\}/gi, (match, hex) => {
      const codePoint = Number.parseInt(hex, 16)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
    })
    .replace(/\\u([0-9a-f]{4})/gi, (_match, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    .replace(/\\x([0-9a-f]{2})/gi, (_match, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
}

export function formatJson(input, spaces = 2) {
  return JSON.stringify(JSON.parse(String(input ?? '')), null, spaces)
}

export function minifyJson(input) {
  return JSON.stringify(JSON.parse(String(input ?? '')))
}

export function decodeJwt(input) {
  const token = String(input ?? '').trim()
  const parts = token.split('.')
  if (parts.length < 2) throw new Error('JWT 至少需要 header 和 payload 两段')

  const header = parseBase64UrlJson(parts[0], 'header')
  const payload = parseBase64UrlJson(parts[1], 'payload')
  return {
    header,
    payload,
    signature: parts[2] || ''
  }
}

export async function verifyJwtHs(input, secret) {
  const token = String(input ?? '').trim()
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('JWT 校验需要完整的三段 token')
  const decoded = decodeJwt(token)
  const alg = decoded.header.alg
  const hash = {
    HS256: 'SHA-256',
    HS384: 'SHA-384',
    HS512: 'SHA-512'
  }[alg]
  if (!hash) throw new Error(`仅支持 HS256/HS384/HS512，当前 alg 为 ${alg || '空'}`)
  const expected = await hmacBytes(hash, `${parts[0]}.${parts[1]}`, secret)
  const actual = base64UrlToBytes(parts[2])
  return timingSafeEqual(expected, actual)
}

export async function digestHex(algorithm, input) {
  const normalized = String(algorithm).toUpperCase()
  if (normalized === 'MD5') return md5(input)
  if (!SHA_ALGORITHMS.has(normalized)) throw new Error(`不支持的摘要算法: ${algorithm}`)
  const digest = await getSubtle().digest(normalized, textToBytes(input))
  return bytesToHex(new Uint8Array(digest))
}

export async function hmacHex(algorithm, input, secret) {
  return bytesToHex(await hmacBytes(algorithm, input, secret))
}

export async function encryptAes(input, passphrase, algorithm = 'AES-GCM') {
  if (!passphrase) throw new Error('密钥不能为空')
  const normalized = normalizeAesAlgorithm(algorithm)
  const salt = randomBytes(16)
  const iv = randomBytes(normalized === 'AES-GCM' ? 12 : 16)
  const iterations = 120000
  const key = await deriveAesKey(passphrase, salt, normalized, iterations)
  const encrypted = await getSubtle().encrypt({ name: normalized, iv }, key, textToBytes(input))
  return JSON.stringify(
    {
      v: 1,
      alg: normalized,
      kdf: 'PBKDF2',
      hash: 'SHA-256',
      iterations,
      salt: bytesToBase64Url(salt),
      iv: bytesToBase64Url(iv),
      ciphertext: bytesToBase64Url(new Uint8Array(encrypted))
    },
    null,
    2
  )
}

export async function decryptAes(input, passphrase) {
  if (!passphrase) throw new Error('密钥不能为空')
  const payload = JSON.parse(String(input ?? ''))
  const algorithm = normalizeAesAlgorithm(payload.alg)
  const salt = base64UrlToBytes(payload.salt)
  const iv = base64UrlToBytes(payload.iv)
  const ciphertext = base64UrlToBytes(payload.ciphertext)
  const key = await deriveAesKey(passphrase, salt, algorithm, payload.iterations || 120000)
  const decrypted = await getSubtle().decrypt({ name: algorithm, iv }, key, ciphertext)
  return bytesToText(new Uint8Array(decrypted))
}

export function md5(input) {
  const bytes = textToBytes(input)
  const wordCount = (((bytes.length + 8) >> 6) + 1) * 16
  const words = new Uint32Array(wordCount)

  for (let i = 0; i < bytes.length; i += 1) {
    words[i >> 2] |= bytes[i] << ((i % 4) * 8)
  }
  words[bytes.length >> 2] |= 0x80 << ((bytes.length % 4) * 8)
  const bitLength = bytes.length * 8
  words[wordCount - 2] = bitLength & 0xffffffff
  words[wordCount - 1] = Math.floor(bitLength / 0x100000000)

  let a = 0x67452301
  let b = 0xefcdab89
  let c = 0x98badcfe
  let d = 0x10325476

  for (let i = 0; i < words.length; i += 16) {
    const oldA = a
    const oldB = b
    const oldC = c
    const oldD = d

    a = ff(a, b, c, d, words[i], 7, -680876936)
    d = ff(d, a, b, c, words[i + 1], 12, -389564586)
    c = ff(c, d, a, b, words[i + 2], 17, 606105819)
    b = ff(b, c, d, a, words[i + 3], 22, -1044525330)
    a = ff(a, b, c, d, words[i + 4], 7, -176418897)
    d = ff(d, a, b, c, words[i + 5], 12, 1200080426)
    c = ff(c, d, a, b, words[i + 6], 17, -1473231341)
    b = ff(b, c, d, a, words[i + 7], 22, -45705983)
    a = ff(a, b, c, d, words[i + 8], 7, 1770035416)
    d = ff(d, a, b, c, words[i + 9], 12, -1958414417)
    c = ff(c, d, a, b, words[i + 10], 17, -42063)
    b = ff(b, c, d, a, words[i + 11], 22, -1990404162)
    a = ff(a, b, c, d, words[i + 12], 7, 1804603682)
    d = ff(d, a, b, c, words[i + 13], 12, -40341101)
    c = ff(c, d, a, b, words[i + 14], 17, -1502002290)
    b = ff(b, c, d, a, words[i + 15], 22, 1236535329)

    a = gg(a, b, c, d, words[i + 1], 5, -165796510)
    d = gg(d, a, b, c, words[i + 6], 9, -1069501632)
    c = gg(c, d, a, b, words[i + 11], 14, 643717713)
    b = gg(b, c, d, a, words[i], 20, -373897302)
    a = gg(a, b, c, d, words[i + 5], 5, -701558691)
    d = gg(d, a, b, c, words[i + 10], 9, 38016083)
    c = gg(c, d, a, b, words[i + 15], 14, -660478335)
    b = gg(b, c, d, a, words[i + 4], 20, -405537848)
    a = gg(a, b, c, d, words[i + 9], 5, 568446438)
    d = gg(d, a, b, c, words[i + 14], 9, -1019803690)
    c = gg(c, d, a, b, words[i + 3], 14, -187363961)
    b = gg(b, c, d, a, words[i + 8], 20, 1163531501)
    a = gg(a, b, c, d, words[i + 13], 5, -1444681467)
    d = gg(d, a, b, c, words[i + 2], 9, -51403784)
    c = gg(c, d, a, b, words[i + 7], 14, 1735328473)
    b = gg(b, c, d, a, words[i + 12], 20, -1926607734)

    a = hh(a, b, c, d, words[i + 5], 4, -378558)
    d = hh(d, a, b, c, words[i + 8], 11, -2022574463)
    c = hh(c, d, a, b, words[i + 11], 16, 1839030562)
    b = hh(b, c, d, a, words[i + 14], 23, -35309556)
    a = hh(a, b, c, d, words[i + 1], 4, -1530992060)
    d = hh(d, a, b, c, words[i + 4], 11, 1272893353)
    c = hh(c, d, a, b, words[i + 7], 16, -155497632)
    b = hh(b, c, d, a, words[i + 10], 23, -1094730640)
    a = hh(a, b, c, d, words[i + 13], 4, 681279174)
    d = hh(d, a, b, c, words[i], 11, -358537222)
    c = hh(c, d, a, b, words[i + 3], 16, -722521979)
    b = hh(b, c, d, a, words[i + 6], 23, 76029189)
    a = hh(a, b, c, d, words[i + 9], 4, -640364487)
    d = hh(d, a, b, c, words[i + 12], 11, -421815835)
    c = hh(c, d, a, b, words[i + 15], 16, 530742520)
    b = hh(b, c, d, a, words[i + 2], 23, -995338651)

    a = ii(a, b, c, d, words[i], 6, -198630844)
    d = ii(d, a, b, c, words[i + 7], 10, 1126891415)
    c = ii(c, d, a, b, words[i + 14], 15, -1416354905)
    b = ii(b, c, d, a, words[i + 5], 21, -57434055)
    a = ii(a, b, c, d, words[i + 12], 6, 1700485571)
    d = ii(d, a, b, c, words[i + 3], 10, -1894986606)
    c = ii(c, d, a, b, words[i + 10], 15, -1051523)
    b = ii(b, c, d, a, words[i + 1], 21, -2054922799)
    a = ii(a, b, c, d, words[i + 8], 6, 1873313359)
    d = ii(d, a, b, c, words[i + 15], 10, -30611744)
    c = ii(c, d, a, b, words[i + 6], 15, -1560198380)
    b = ii(b, c, d, a, words[i + 13], 21, 1309151649)
    a = ii(a, b, c, d, words[i + 4], 6, -145523070)
    d = ii(d, a, b, c, words[i + 11], 10, -1120210379)
    c = ii(c, d, a, b, words[i + 2], 15, 718787259)
    b = ii(b, c, d, a, words[i + 9], 21, -343485551)

    a = add32(a, oldA)
    b = add32(b, oldB)
    c = add32(c, oldC)
    d = add32(d, oldD)
  }

  return [a, b, c, d]
    .map((word) =>
      [word & 0xff, (word >>> 8) & 0xff, (word >>> 16) & 0xff, (word >>> 24) & 0xff]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
    )
    .join('')
}

async function hmacBytes(algorithm, input, secret) {
  if (!secret) throw new Error('密钥不能为空')
  const normalized = String(algorithm).toUpperCase()
  if (!SHA_ALGORITHMS.has(normalized)) throw new Error(`不支持的 HMAC 算法: ${algorithm}`)
  const key = await getSubtle().importKey(
    'raw',
    textToBytes(secret),
    { name: 'HMAC', hash: normalized },
    false,
    ['sign']
  )
  const signed = await getSubtle().sign('HMAC', key, textToBytes(input))
  return new Uint8Array(signed)
}

async function deriveAesKey(passphrase, salt, algorithm, iterations) {
  const baseKey = await getSubtle().importKey('raw', textToBytes(passphrase), 'PBKDF2', false, [
    'deriveKey'
  ])
  return getSubtle().deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256'
    },
    baseKey,
    {
      name: algorithm,
      length: 256
    },
    false,
    ['encrypt', 'decrypt']
  )
}

function parseBase64UrlJson(value, label) {
  try {
    return JSON.parse(base64UrlDecode(value))
  } catch (error) {
    throw new Error(`JWT ${label} 解析失败: ${error.message}`)
  }
}

function normalizeBase64(input) {
  const clean = String(input ?? '').replace(/\s+/g, '')
  if (!clean) return ''
  return clean.padEnd(clean.length + ((4 - (clean.length % 4)) % 4), '=')
}

function normalizeAesAlgorithm(algorithm) {
  const normalized = String(algorithm ?? '').toUpperCase()
  if (normalized === 'AES-GCM' || normalized === 'AES-CBC') return normalized
  throw new Error(`不支持的 AES 算法: ${algorithm}`)
}

function randomBytes(length) {
  const bytes = new Uint8Array(length)
  getCrypto().getRandomValues(bytes)
  return bytes
}

function getCrypto() {
  if (globalThis.crypto) return globalThis.crypto
  throw new Error('当前运行环境不支持 Web Crypto')
}

function getSubtle() {
  const cryptoRef = getCrypto()
  if (!cryptoRef.subtle) throw new Error('当前运行环境不支持 crypto.subtle')
  return cryptoRef.subtle
}

function toUint8Array(bytes) {
  if (bytes instanceof Uint8Array) return bytes
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes)
  return Uint8Array.from(bytes ?? [])
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false
  let diff = 0
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i]
  return diff === 0
}

function add32(a, b) {
  return (a + b) | 0
}

function rotateLeft(value, shift) {
  return (value << shift) | (value >>> (32 - shift))
}

function cmn(q, a, b, x, s, t) {
  return add32(rotateLeft(add32(add32(a, q), add32(x, t)), s), b)
}

function ff(a, b, c, d, x, s, t) {
  return cmn((b & c) | (~b & d), a, b, x, s, t)
}

function gg(a, b, c, d, x, s, t) {
  return cmn((b & d) | (c & ~d), a, b, x, s, t)
}

function hh(a, b, c, d, x, s, t) {
  return cmn(b ^ c ^ d, a, b, x, s, t)
}

function ii(a, b, c, d, x, s, t) {
  return cmn(c ^ (b | ~d), a, b, x, s, t)
}
