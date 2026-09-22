import { describe, expect, it } from 'vitest'
import { derive, hash } from './scrypt-kdf'

describe('scrypt', () => {
  it('derives consistent key with same params', () => {
    const params = { password: 'pass', salt: 'salt', keylen: 32, N: 1024, r: 8, p: 1 }
    const a = derive(params)
    const b = derive(params)
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.data).toBe(b.data)
      expect(a.data.length).toBe(64)
    }
  })

  it('different salts produce different keys', () => {
    const a = derive({ password: 'pass', salt: 'salt1', keylen: 32, N: 1024, r: 8, p: 1 })
    const b = derive({ password: 'pass', salt: 'salt2', keylen: 32, N: 1024, r: 8, p: 1 })
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.data).not.toBe(b.data)
    }
  })

  it('rejects empty password', () => {
    const r = derive({ password: '', salt: 'salt', keylen: 32, N: 1024, r: 8, p: 1 })
    expect(r.ok).toBe(false)
  })

  it('rejects non-power-of-two N', () => {
    const r = derive({ password: 'pass', salt: 'salt', keylen: 32, N: 1000, r: 8, p: 1 })
    expect(r.ok).toBe(false)
  })

  it('rejects invalid keylen', () => {
    const r = derive({ password: 'pass', salt: 'salt', keylen: 0, N: 1024, r: 8, p: 1 })
    expect(r.ok).toBe(false)
  })

  it('hash produces verifiable format', () => {
    const r = hash({ password: 'pass', salt: 'salt', cost: 1024 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toContain('$scrypt$')
      expect(r.data).toContain('N=1024')
    }
  })
})
