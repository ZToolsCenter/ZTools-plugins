import { describe, expect, it } from 'vitest'
import { generateKeyPair, deriveSharedSecret } from './ecdh'

describe('ecdh', () => {
  it('generates P-256 key pair', () => {
    const r = generateKeyPair({ curve: 'prime256v1' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.publicKey).toMatch(/^[0-9a-f]+$/i)
      expect(r.data.privateKey).toMatch(/^[0-9a-f]+$/i)
    }
  })

  it('two parties derive same shared secret', () => {
    const a = generateKeyPair({ curve: 'prime256v1' })
    const b = generateKeyPair({ curve: 'prime256v1' })
    if (a.ok && b.ok) {
      const secretA = deriveSharedSecret({ privateKey: a.data.privateKey, peerPublicKey: b.data.publicKey, curve: 'prime256v1' })
      const secretB = deriveSharedSecret({ privateKey: b.data.privateKey, peerPublicKey: a.data.publicKey, curve: 'prime256v1' })
      expect(secretA.ok).toBe(true)
      expect(secretB.ok).toBe(true)
      if (secretA.ok && secretB.ok) expect(secretA.data).toBe(secretB.data)
    }
  })

  it('supports secp384r1', () => {
    const r = generateKeyPair({ curve: 'secp384r1' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.curve).toBe('secp384r1')
  })

  it('rejects empty private key', () => {
    const peer = generateKeyPair({})
    if (peer.ok) {
      const r = deriveSharedSecret({ privateKey: '', peerPublicKey: peer.data.publicKey })
      expect(r.ok).toBe(false)
    }
  })
})
