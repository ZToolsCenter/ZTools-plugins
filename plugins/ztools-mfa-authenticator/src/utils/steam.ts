import { Secret } from 'otpauth'

const STEAM_CHARS = '23456789BCDFGHJKMNPQRTVWXY'

export async function generateSteamCode(secret: string, timestamp?: number): Promise<string> {
  const keyBytes = Secret.fromBase32(secret).buffer as ArrayBuffer
  const time = Math.floor((timestamp ?? Date.now()) / 1000 / 30)

  const timeBuffer = new ArrayBuffer(8)
  const view = new DataView(timeBuffer)
  view.setUint32(4, time, false)

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )

  const hmac = await crypto.subtle.sign('HMAC', cryptoKey, timeBuffer)
  const hash = new Uint8Array(hmac)

  const offset = hash[hash.length - 1] & 0x0f
  let fullCode =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff)

  let code = ''
  for (let i = 0; i < 5; i++) {
    code += STEAM_CHARS[fullCode % STEAM_CHARS.length]
    fullCode = Math.floor(fullCode / STEAM_CHARS.length)
  }

  return code
}
