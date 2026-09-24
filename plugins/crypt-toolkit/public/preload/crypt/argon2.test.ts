import { describe, expect, it } from 'vitest'
import { hash, verify } from './argon2'

describe('argon2', () => {
  it('hashes with argon2id', async () => {
    const r = await hash({
      password: 'mypassword',
      type: 'argon2id',
      timeCost: 2,
      memoryCost: 16384,
      parallelism: 1,
      hashLength: 32
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toContain('$argon2id$')
      expect(r.data).toContain('v=19')
    }
  }, 30000)

  it('verify succeeds with correct password', async () => {
    const h = await hash({
      password: 'correct horse battery staple',
      type: 'argon2id',
      timeCost: 2,
      memoryCost: 16384,
      parallelism: 1,
      hashLength: 32
    })
    expect(h.ok).toBe(true)
    if (h.ok) {
      const v = await verify({ password: 'correct horse battery staple', hash: h.data })
      expect(v.ok).toBe(true)
      if (v.ok) {
        expect(v.data).toBe(true)
      }
    }
  }, 30000)

  it('verify returns false with wrong password', async () => {
    const h = await hash({
      password: 'right',
      type: 'argon2id',
      timeCost: 2,
      memoryCost: 16384,
      parallelism: 1,
      hashLength: 32
    })
    expect(h.ok).toBe(true)
    if (h.ok) {
      const v = await verify({ password: 'wrong', hash: h.data })
      expect(v.ok).toBe(true)
      if (v.ok) {
        expect(v.data).toBe(false)
      }
    }
  }, 30000)

  it('supports argon2i variant', async () => {
    const r = await hash({
      password: 'test',
      type: 'argon2i',
      timeCost: 2,
      memoryCost: 16384,
      parallelism: 1,
      hashLength: 32
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toContain('$argon2i$')
    }
  }, 30000)

  it('verify fails with invalid hash string', async () => {
    const r = await verify({ password: 'test', hash: 'invalid-hash' })
    expect(r.ok).toBe(false)
  }, 10000)
})
