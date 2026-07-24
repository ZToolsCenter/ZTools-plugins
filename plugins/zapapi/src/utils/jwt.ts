export type JwtHmacAlgorithm = 'HS256' | 'HS384' | 'HS512'

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function encodeText(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function textToArrayBuffer(value: string): ArrayBuffer {
  const bytes = encodeText(value)
  const copied = new Uint8Array(bytes.length)
  copied.set(bytes)
  return copied.buffer
}

function parseJsonObject(value: string, errorMessage: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(errorMessage)
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(errorMessage)
  }

  return parsed as Record<string, unknown>
}

function toSubtleHash(algorithm: JwtHmacAlgorithm): 'SHA-256' | 'SHA-384' | 'SHA-512' {
  if (algorithm === 'HS384') {
    return 'SHA-384'
  }
  if (algorithm === 'HS512') {
    return 'SHA-512'
  }
  return 'SHA-256'
}

export async function createJwtToken(options: {
  algorithm: JwtHmacAlgorithm
  headerJson: string
  payloadJson: string
  secret: string
  autoIat: boolean
  autoExp: boolean
  expSeconds: string
}): Promise<string> {
  const { algorithm, headerJson, payloadJson, secret, autoIat, autoExp, expSeconds } = options

  const header = parseJsonObject(headerJson, 'JWT header must be valid JSON object')
  const payload = parseJsonObject(payloadJson, 'JWT payload must be valid JSON object')

  if (!secret) {
    throw new Error('JWT secret is required')
  }

  const now = Math.floor(Date.now() / 1000)
  const normalizedPayload: Record<string, unknown> = { ...payload }
  if (autoIat && typeof normalizedPayload.iat !== 'number') {
    normalizedPayload.iat = now
  }

  if (autoExp) {
    const seconds = Number.parseInt(expSeconds, 10)
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new Error('JWT exp seconds must be a positive integer')
    }
    normalizedPayload.exp = now + seconds
  }

  const normalizedHeader = {
    ...header,
    alg: algorithm,
    typ: typeof header.typ === 'string' ? header.typ : 'JWT'
  }

  const encodedHeader = toBase64Url(encodeText(JSON.stringify(normalizedHeader)))
  const encodedPayload = toBase64Url(encodeText(JSON.stringify(normalizedPayload)))
  const signingInput = `${encodedHeader}.${encodedPayload}`

  const key = await crypto.subtle.importKey(
    'raw',
    textToArrayBuffer(secret),
    { name: 'HMAC', hash: toSubtleHash(algorithm) },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign('HMAC', key, textToArrayBuffer(signingInput))
  const encodedSignature = toBase64Url(new Uint8Array(signature))

  return `${signingInput}.${encodedSignature}`
}
