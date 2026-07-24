function decodeQuotedValue(value: string): string {
  return value.replace(/^"|"$/g, '').replace(/\\"/g, '"')
}

function parseDigestChallenge(challengeHeader: string): Record<string, string> {
  const trimmed = challengeHeader.trim()
  if (!/^Digest\s+/i.test(trimmed)) {
    return {}
  }

  const content = trimmed.replace(/^Digest\s+/i, '')
  const result: Record<string, string> = {}

  const pairPattern = /(\w+)=("(?:[^"\\]|\\.)*"|[^,]+)/g
  let match: RegExpExecArray | null
  while ((match = pairPattern.exec(content)) !== null) {
    const key = match[1].toLowerCase()
    result[key] = decodeQuotedValue(match[2].trim())
  }

  return result
}

function randomHex(length: number): string {
  const bytes = new Uint8Array(Math.ceil(length / 2))
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, length)
}

function rotateLeft(value: number, shift: number): number {
  return (value << shift) | (value >>> (32 - shift))
}

function addUnsigned(a: number, b: number): number {
  return (a + b) >>> 0
}

function toWordArray(input: string): number[] {
  const utf8 = unescape(encodeURIComponent(input))
  const messageLength = utf8.length
  const wordCount = (((messageLength + 8) >>> 6) + 1) * 16
  const words = new Array<number>(wordCount).fill(0)

  for (let i = 0; i < messageLength; i += 1) {
    words[i >>> 2] |= utf8.charCodeAt(i) << ((i % 4) * 8)
  }

  words[messageLength >>> 2] |= 0x80 << ((messageLength % 4) * 8)
  const bitLength = messageLength * 8
  words[wordCount - 2] = bitLength & 0xffffffff
  words[wordCount - 1] = Math.floor(bitLength / 0x100000000)

  return words
}

function wordToHex(value: number): string {
  const bytes = [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function md5Hex(input: string): string {
  const x = toWordArray(input)
  let a = 0x67452301
  let b = 0xefcdab89
  let c = 0x98badcfe
  let d = 0x10325476

  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ]

  const k: number[] = []
  for (let i = 0; i < 64; i += 1) {
    k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0
  }

  for (let i = 0; i < x.length; i += 16) {
    const aa = a
    const bb = b
    const cc = c
    const dd = d

    for (let j = 0; j < 64; j += 1) {
      let f = 0
      let g = 0

      if (j < 16) {
        f = (b & c) | (~b & d)
        g = j
      } else if (j < 32) {
        f = (d & b) | (~d & c)
        g = (5 * j + 1) % 16
      } else if (j < 48) {
        f = b ^ c ^ d
        g = (3 * j + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * j) % 16
      }

      const tempD = d
      d = c
      c = b
      const sum = addUnsigned(addUnsigned(addUnsigned(a, f), k[j]), x[i + g])
      b = addUnsigned(b, rotateLeft(sum, s[j]))
      a = tempD
    }

    a = addUnsigned(a, aa)
    b = addUnsigned(b, bb)
    c = addUnsigned(c, cc)
    d = addUnsigned(d, dd)
  }

  return `${wordToHex(a)}${wordToHex(b)}${wordToHex(c)}${wordToHex(d)}`
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

type DigestAlgorithm = 'MD5' | 'MD5-sess' | 'SHA-256' | 'SHA-256-sess'

async function digestHashHex(algorithm: DigestAlgorithm, input: string): Promise<string> {
  if (algorithm === 'SHA-256' || algorithm === 'SHA-256-sess') {
    return sha256Hex(input)
  }

  return md5Hex(input)
}

export async function createDigestAuthorization(options: {
  challengeHeader: string
  method: string
  requestUrl: string
  username: string
  password: string
  algorithm?: DigestAlgorithm
}): Promise<string> {
  const { challengeHeader, method, requestUrl, username, password } = options
  const requestedAlgorithm = options.algorithm || 'MD5'
  const challenge = parseDigestChallenge(challengeHeader)

  const realm = challenge.realm
  const nonce = challenge.nonce
  if (!realm || !nonce) {
    throw new Error('Invalid Digest challenge')
  }

  const parsedUrl = new URL(requestUrl)
  const uri = `${parsedUrl.pathname}${parsedUrl.search}`
  const qopRaw = challenge.qop || ''
  const qop = qopRaw.split(',').map((item) => item.trim()).find((item) => item === 'auth')

  const nc = '00000001'
  const cnonce = randomHex(16)

  const challengeAlgorithm = (challenge.algorithm || '').toUpperCase()
  const useSession = requestedAlgorithm.endsWith('-sess') || challengeAlgorithm.endsWith('-SESS')
  const resolvedAlgorithm: DigestAlgorithm = requestedAlgorithm.startsWith('SHA-256') || challengeAlgorithm.startsWith('SHA-256')
    ? (useSession ? 'SHA-256-sess' : 'SHA-256')
    : (useSession ? 'MD5-sess' : 'MD5')

  const ha1Base = await digestHashHex(resolvedAlgorithm, `${username}:${realm}:${password}`)
  const ha1 = useSession
    ? await digestHashHex(resolvedAlgorithm, `${ha1Base}:${nonce}:${cnonce}`)
    : ha1Base

  const ha2 = await digestHashHex(resolvedAlgorithm, `${method.toUpperCase()}:${uri}`)
  const response = qop
    ? await digestHashHex(resolvedAlgorithm, `${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : await digestHashHex(resolvedAlgorithm, `${ha1}:${nonce}:${ha2}`)

  const parts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`
  ]

  if (challenge.opaque) {
    parts.push(`opaque="${challenge.opaque}"`)
  }

  parts.push(`algorithm="${resolvedAlgorithm}"`)

  if (qop) {
    parts.push(`qop=${qop}`)
    parts.push(`nc=${nc}`)
    parts.push(`cnonce="${cnonce}"`)
  }

  return `Digest ${parts.join(', ')}`
}
