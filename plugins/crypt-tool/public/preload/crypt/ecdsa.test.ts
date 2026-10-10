import { describe, expect, it } from 'vitest'
import { generateKeyPair, sign, verify } from './ecdsa'

describe('ecdsa', () => {
  it('generates a P-256 key pair', () => {
    const r = generateKeyPair({ curve: 'prime256v1' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.publicKey).toContain('BEGIN PUBLIC KEY')
      expect(r.data.privateKey).toContain('BEGIN PRIVATE KEY')
      expect(r.data.curve).toBe('prime256v1')
    }
  })

  it('sign + verify round trip', () => {
    const kp = generateKeyPair({ curve: 'prime256v1' })
    expect(kp.ok).toBe(true)
    if (kp.ok) {
      const data = 'Hello, ECDSA!'
      const sig = sign({ privateKey: kp.data.privateKey, data, hash: 'sha256' })
      expect(sig.ok).toBe(true)
      if (sig.ok) {
        const v = verify({ publicKey: kp.data.publicKey, data, signature: sig.data, hash: 'sha256' })
        expect(v.ok).toBe(true)
        if (v.ok) expect(v.data).toBe(true)
      }
    }
  })

  it('verify fails with wrong data', () => {
    const kp = generateKeyPair({ curve: 'prime256v1' })
    if (kp.ok) {
      const sig = sign({ privateKey: kp.data.privateKey, data: 'original', hash: 'sha256' })
      expect(sig.ok).toBe(true)
      if (sig.ok) {
        const v = verify({ publicKey: kp.data.publicKey, data: 'tampered', signature: sig.data, hash: 'sha256' })
        expect(v.ok).toBe(true)
        if (v.ok) expect(v.data).toBe(false)
      }
    }
  })

  it('rejects invalid curve', () => {
    const r = generateKeyPair({ curve: 'invalid_curve' })
    expect(r.ok).toBe(false)
  })

  it('sign fails with empty key', () => {
    const r = sign({ privateKey: '', data: 'test' })
    expect(r.ok).toBe(false)
  })
})
