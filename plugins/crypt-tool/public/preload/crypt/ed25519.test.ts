import { describe, expect, it } from 'vitest'
import { generateKeyPair, sign, verify } from './ed25519'

describe('ed25519', () => {
  it('generates a valid key pair', () => {
    const r = generateKeyPair()
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.publicKey).toContain('BEGIN PUBLIC KEY')
      expect(r.data.privateKey).toContain('BEGIN PRIVATE KEY')
    }
  })

  it('sign + verify round trip', () => {
    const kp = generateKeyPair()
    expect(kp.ok).toBe(true)
    if (kp.ok) {
      const data = 'Hello, Ed25519!'
      const sig = sign({ privateKey: kp.ok ? kp.data.privateKey : '', data })
      expect(sig.ok).toBe(true)
      if (sig.ok) {
        const v = verify({ publicKey: kp.data.publicKey, data, signature: sig.data })
        expect(v.ok).toBe(true)
        if (v.ok) {
          expect(v.data).toBe(true)
        }
      }
    }
  })

  it('verify fails with wrong data', () => {
    const kp = generateKeyPair()
    expect(kp.ok).toBe(true)
    if (kp.ok) {
      const sig = sign({ privateKey: kp.data.privateKey, data: 'original' })
      expect(sig.ok).toBe(true)
      if (sig.ok) {
        const v = verify({ publicKey: kp.data.publicKey, data: 'tampered', signature: sig.data })
        expect(v.ok).toBe(true)
        if (v.ok) {
          expect(v.data).toBe(false)
        }
      }
    }
  })

  it('verify fails with wrong public key', () => {
    const kp1 = generateKeyPair()
    const kp2 = generateKeyPair()
    if (kp1.ok && kp2.ok) {
      const sig = sign({ privateKey: kp1.data.privateKey, data: 'test' })
      expect(sig.ok).toBe(true)
      if (sig.ok) {
        const v = verify({ publicKey: kp2.data.publicKey, data: 'test', signature: sig.data })
        expect(v.ok).toBe(true)
        if (v.ok) {
          expect(v.data).toBe(false)
        }
      }
    }
  })

  it('sign fails with empty key', () => {
    const r = sign({ privateKey: '', data: 'test' })
    expect(r.ok).toBe(false)
  })

  it('sign fails with empty data', () => {
    const kp = generateKeyPair()
    expect(kp.ok).toBe(true)
    if (kp.ok) {
      const r = sign({ privateKey: kp.data.privateKey, data: '' })
      expect(r.ok).toBe(true)
    }
  })
})
