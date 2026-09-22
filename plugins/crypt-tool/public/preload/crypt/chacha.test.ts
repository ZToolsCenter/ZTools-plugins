import { describe, expect, it } from 'vitest'
import { encrypt, decrypt, keygen, noncegen } from './chacha'

describe('chacha20-poly1305', () => {
  it('generates a valid 32-byte key (base64)', () => {
    const r = keygen()
    expect(r.ok).toBe(true)
    if (r.ok) {
      const buf = Buffer.from(r.data, 'base64')
      expect(buf.length).toBe(32)
    }
  })

  it('generates a valid 12-byte nonce (base64)', () => {
    const r = noncegen()
    expect(r.ok).toBe(true)
    if (r.ok) {
      const buf = Buffer.from(r.data, 'base64')
      expect(buf.length).toBe(12)
    }
  })

  it('encrypt + decrypt round trip', () => {
    const key = Buffer.alloc(32, 0xab).toString('base64')
    const nonce = Buffer.alloc(12, 0x12).toString('base64')
    const plaintext = '你好，ChaCha20-Poly1305!'

    const enc = encrypt({ key, nonce, plaintext })
    expect(enc.ok).toBe(true)
    if (enc.ok) {
      expect(enc.data).not.toBe('')
      const dec = decrypt({ key, nonce, ciphertext: enc.data })
      expect(dec.ok).toBe(true)
      if (dec.ok) {
        expect(dec.data).toBe(plaintext)
      }
    }
  })

  it('fails decrypt with wrong key', () => {
    const key = Buffer.alloc(32, 0xab).toString('base64')
    const nonce = Buffer.alloc(12, 0x12).toString('base64')
    const enc = encrypt({ key, nonce, plaintext: 'secret data' })
    expect(enc.ok).toBe(true)
    if (enc.ok) {
      const wrongKey = Buffer.alloc(32, 0xff).toString('base64')
      const dec = decrypt({ key: wrongKey, nonce, ciphertext: enc.data })
      expect(dec.ok).toBe(false)
    }
  })

  it('rejects invalid key length', () => {
    const r = encrypt({ key: 'short', nonce: 'dGVzdHRlc3R0ZXN0', plaintext: 'hi' })
    expect(r.ok).toBe(false)
  })

  it('rejects invalid nonce length', () => {
    const key = Buffer.alloc(32, 0xab).toString('base64')
    const r = encrypt({ key, nonce: 'short', plaintext: 'hi' })
    expect(r.ok).toBe(false)
  })

  it('rejects tampered ciphertext', () => {
    const key = Buffer.alloc(32, 0xab).toString('base64')
    const nonce = Buffer.alloc(12, 0x12).toString('base64')
    const enc = encrypt({ key, nonce, plaintext: 'hello' })
    expect(enc.ok).toBe(true)
    if (enc.ok) {
      const raw = Buffer.from(enc.data, 'base64')
      raw[0] ^= 0xff
      const tampered = raw.toString('base64')
      const dec = decrypt({ key, nonce, ciphertext: tampered })
      expect(dec.ok).toBe(false)
    }
  })
})
