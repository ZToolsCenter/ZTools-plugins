import { describe, expect, it } from 'vitest'
import { encrypt, decrypt, keygen, ivgen } from './des'

describe('des-ede3-cbc', () => {
  it('generates a valid 24-byte key', () => {
    const r = keygen()
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(Buffer.from(r.data, 'base64').length).toBe(24)
    }
  })

  it('generates a valid 8-byte IV', () => {
    const r = ivgen()
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(Buffer.from(r.data, 'base64').length).toBe(8)
    }
  })

  it('encrypt + decrypt round trip', () => {
    const key = Buffer.alloc(24, 0xab).toString('base64')
    const iv = Buffer.alloc(8, 0x12).toString('base64')
    const plaintext = '你好，3DES!'

    const enc = encrypt({ key, iv, plaintext })
    expect(enc.ok).toBe(true)
    if (enc.ok) {
      expect(enc.data).not.toBe('')
      const dec = decrypt({ key, iv, ciphertext: enc.data })
      expect(dec.ok).toBe(true)
      if (dec.ok) expect(dec.data).toBe(plaintext)
    }
  })

  it('rejects invalid key length', () => {
    const r = encrypt({ key: 'short', iv: Buffer.alloc(8).toString('base64'), plaintext: 'hi' })
    expect(r.ok).toBe(false)
  })

  it('rejects invalid IV length', () => {
    const key = Buffer.alloc(24).toString('base64')
    const r = encrypt({ key, iv: 'short', plaintext: 'hi' })
    expect(r.ok).toBe(false)
  })

  it('fails decrypt with wrong key', () => {
    const key = Buffer.alloc(24, 0xab).toString('base64')
    const iv = Buffer.alloc(8, 0x12).toString('base64')
    const enc = encrypt({ key, iv, plaintext: 'data' })
    expect(enc.ok).toBe(true)
    if (enc.ok) {
      const wrongKey = Buffer.alloc(24, 0xff).toString('base64')
      const dec = decrypt({ key: wrongKey, iv, ciphertext: enc.data })
      expect(dec.ok).toBe(false)
    }
  })
})
