import { describe, expect, it } from 'vitest'
import { hmac, pbkdf2 } from './index.js'

describe('hmac', () => {
  it('signs sha256 known vector', () => {
    const r = hmac.sign({ key: 'key', data: 'The quick brown fox jumps over the lazy dog', algo: 'sha256' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8')
  })

  it('verifies matching signature', () => {
    const r = hmac.verify({
      key: 'key',
      data: 'The quick brown fox jumps over the lazy dog',
      algo: 'sha256',
      signature: 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8'
    })
    expect(r).toEqual({ ok: true, data: true })
  })

  it('rejects mismatch', () => {
    const r = hmac.verify({ key: 'key', data: 'x', algo: 'sha256', signature: 'deadbeef' })
    expect(r).toEqual({ ok: true, data: false })
  })

  it('rejects bad algo', () => {
    const r = hmac.sign({ key: 'k', data: 'x', algo: 'md5' })
    expect(r.ok).toBe(false)
  })
})

describe('pbkdf2', () => {
  it('derives deterministic key', () => {
    const params = { password: 'pw', salt: 'NaCl', iterations: 1000, keylen: 32, hash: 'sha256' }
    const a = pbkdf2.derive(params)
    const b = pbkdf2.derive(params)
    expect(a.ok).toBe(true)
    expect(a).toEqual(b)
    if (!a.ok) return
    expect(a.data).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects bad params', () => {
    expect(pbkdf2.derive({ password: 'pw', salt: 's', iterations: 0, keylen: 32, hash: 'sha256' }).ok).toBe(false)
    expect(pbkdf2.derive({ password: 'pw', salt: 's', iterations: 10, keylen: 0, hash: 'sha256' }).ok).toBe(false)
    expect(pbkdf2.derive({ password: 'pw', salt: 's', iterations: 10, keylen: 32, hash: 'md5' as any }).ok).toBe(false)
  })
})
