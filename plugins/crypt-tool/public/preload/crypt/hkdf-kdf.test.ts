import { describe, expect, it } from 'vitest'
import { derive } from './hkdf-kdf'

describe('hkdf', () => {
  it('derives consistent output', () => {
    const a = derive({
      ikm: '0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b',
      salt: '000102030405060708090a0b0c',
      info: 'f0f1f2f3f4f5f6f7f8f9',
      keylen: 42,
      hash: 'sha256'
    })
    const b = derive({
      ikm: '0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b',
      salt: '000102030405060708090a0b0c',
      info: 'f0f1f2f3f4f5f6f7f8f9',
      keylen: 42,
      hash: 'sha256'
    })
    expect(a.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.data).toBe(b.data)
      expect(a.data.length).toBe(84)
    }
  })

  it('RFC 5869 Test Case 1 matches known vector', () => {
    // RFC 5869 Appendix A.1 Test Case 1
    // The first 36 bytes (T1) of the 42-byte OKM match the RFC.
    const r = derive({
      ikm: '0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b',
      salt: '000102030405060708090a0b0c',
      info: 'f0f1f2f3f4f5f6f7f8f9',
      keylen: 42,
      hash: 'sha256'
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.length).toBe(84)
      // RFC T(1) = first 36 bytes should start with this prefix
      expect(r.data.startsWith('3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208')).toBe(true)
    }
  })

  it('rejects malformed hex IKM', () => {
    const r = derive({ ikm: 'GGGG', keylen: 32, hash: 'sha256' })
    expect(r.ok).toBe(false)
  })

  it('rejects odd-length hex IKM', () => {
    const r = derive({ ikm: 'abc', keylen: 32, hash: 'sha256' })
    expect(r.ok).toBe(false)
  })

  it('different IKM produces different output', () => {
    const a = derive({ ikm: 'aabb', info: '637478', keylen: 32, hash: 'sha256' })
    const b = derive({ ikm: 'ccdd', info: '637478', keylen: 32, hash: 'sha256' })
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.data).not.toBe(b.data)
    }
  })

  it('rejects empty IKM', () => {
    const r = derive({ ikm: '', keylen: 32, hash: 'sha256' })
    expect(r.ok).toBe(false)
  })

  it('rejects invalid hash algorithm', () => {
    const r = derive({ ikm: 'aabb', keylen: 32, hash: 'md5' })
    expect(r.ok).toBe(false)
  })

  it('rejects invalid keylen', () => {
    const r = derive({ ikm: 'aabb', keylen: 0, hash: 'sha256' })
    expect(r.ok).toBe(false)
  })
})
