import { describe, expect, it } from 'vitest'
import { encrypt, decrypt } from './xor-cipher'

describe('xor-stream', () => {
  it('encrypt + decrypt round trip', () => {
    const key = 'mykey123'
    const plaintext = 'Hello, XOR!'
    const enc = encrypt({ key, plaintext })
    expect(enc.ok).toBe(true)
    if (enc.ok) {
      const dec = decrypt({ key, ciphertext: enc.data })
      expect(dec.ok).toBe(true)
      if (dec.ok) expect(dec.data).toBe(plaintext)
    }
  })

  it('empty plaintext', () => {
    const r = encrypt({ key: 'key', plaintext: '' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toBe('')
  })

  it('rejects empty key', () => {
    expect(encrypt({ key: '', plaintext: 'data' }).ok).toBe(false)
  })

  it('same key + plaintext produces same output', () => {
    const a = encrypt({ key: 'k', plaintext: 'test' })
    const b = encrypt({ key: 'k', plaintext: 'test' })
    if (a.ok && b.ok) expect(a.data).toBe(b.data)
  })
})
