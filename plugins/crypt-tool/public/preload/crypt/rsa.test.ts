import { describe, expect, it } from 'vitest'
import { rsa } from './index.js'

describe('rsa', () => {
  it('roundtrips with generated keys', () => {
    const pair = rsa.generateKeyPair()
    expect(pair.ok).toBe(true)
    if (!pair.ok) return
    const { publicKey, privateKey } = JSON.parse(pair.data)
    const enc = rsa.encrypt({ publicKey, plaintext: 'Hello RSA' })
    expect(enc.ok).toBe(true)
    if (!enc.ok) return
    const dec = rsa.decrypt({ privateKey, ciphertext: enc.data })
    expect(dec).toEqual({ ok: true, data: 'Hello RSA' })
  })

  it('fails on non-PEM public key', () => {
    const enc = rsa.encrypt({ publicKey: 'not-a-key', plaintext: 'x' })
    expect(enc.ok).toBe(false)
    if (enc.ok) return
    expect(enc.error).toMatch(/公钥/)
  })

  it('fails decrypt with wrong key', () => {
    const a = rsa.generateKeyPair()
    const b = rsa.generateKeyPair()
    if (!a.ok || !b.ok) throw new Error('keygen failed')
    const pa = JSON.parse(a.data)
    const pb = JSON.parse(b.data)
    const enc = rsa.encrypt({ publicKey: pa.publicKey, plaintext: 'secret' })
    if (!enc.ok) throw new Error('encrypt failed')
    const dec = rsa.decrypt({ privateKey: pb.privateKey, ciphertext: enc.data })
    expect(dec.ok).toBe(false)
  })
})
