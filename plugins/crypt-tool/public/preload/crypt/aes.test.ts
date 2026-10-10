import { describe, expect, it } from 'vitest'
import { aes } from './index.js'

const key = '0123456789abcdef'
const iv = 'abcdef0123456789'

describe('aes', () => {
  it('CBC roundtrip', () => {
    const enc = aes.encrypt({ key, iv, mode: 'CBC', plaintext: 'Hello ZTools' })
    expect(enc.ok).toBe(true)
    if (!enc.ok) return
    const dec = aes.decrypt({ key, iv, mode: 'CBC', ciphertext: enc.data })
    expect(dec).toEqual({ ok: true, data: 'Hello ZTools' })
  })

  it('GCM roundtrip', () => {
    const enc = aes.encrypt({ key, iv, mode: 'GCM', plaintext: 'Hello ZTools' })
    expect(enc.ok).toBe(true)
    if (!enc.ok) return
    const dec = aes.decrypt({ key, iv, mode: 'GCM', ciphertext: enc.data })
    expect(dec).toEqual({ ok: true, data: 'Hello ZTools' })
  })

  it('rejects bad key length', () => {
    const enc = aes.encrypt({ key: 'short', iv, mode: 'CBC', plaintext: 'x' })
    expect(enc.ok).toBe(false)
    if (enc.ok) return
    expect(enc.error).toMatch(/密钥/)
  })

  it('rejects bad iv length', () => {
    const enc = aes.encrypt({ key, iv: 'bad', mode: 'CBC', plaintext: 'x' })
    expect(enc.ok).toBe(false)
    if (enc.ok) return
    expect(enc.error).toMatch(/IV/)
  })

  it('GCM fails on tampered ciphertext', () => {
    const enc = aes.encrypt({ key, iv, mode: 'GCM', plaintext: 'Hello ZTools' })
    expect(enc.ok).toBe(true)
    if (!enc.ok) return
    const raw = Buffer.from(enc.data, 'base64')
    raw[0] ^= 0xff
    const dec = aes.decrypt({ key, iv, mode: 'GCM', ciphertext: raw.toString('base64') })
    expect(dec.ok).toBe(false)
  })
})
