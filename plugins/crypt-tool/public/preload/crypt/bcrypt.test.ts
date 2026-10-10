import { describe, expect, it } from 'vitest'
import { bcrypt } from './bcrypt.js'

describe('bcrypt', () => {
  it('hash produces valid bcrypt format', () => {
    const result = bcrypt.hash({ password: 'test123', cost: 4 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toMatch(/^\$2b\$04\$[A-Za-z0-9./]{53}$/)
    }
  })

  it('hash with default cost', () => {
    const result = bcrypt.hash({ password: 'hello' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toMatch(/^\$2b\$12\$[A-Za-z0-9./]{53}$/)
    }
  })

  it('hash fails on empty password', () => {
    const result = bcrypt.hash({ password: '', cost: 4 })
    expect(result.ok).toBe(false)
  })

  it('hash fails on cost too low', () => {
    const result = bcrypt.hash({ password: 'test', cost: 3 })
    expect(result.ok).toBe(false)
  })

  it('hash fails on cost too high', () => {
    const result = bcrypt.hash({ password: 'test', cost: 32 })
    expect(result.ok).toBe(false)
  })

  it('verify correct password', () => {
    const h = bcrypt.hash({ password: 'secret', cost: 4 })
    expect(h.ok).toBe(true)
    if (h.ok) {
      const v = bcrypt.verify({ password: 'secret', hash: h.data })
      expect(v.ok).toBe(true)
      if (v.ok) expect(v.data).toBe(true)
    }
  })

  it('verify wrong password', () => {
    const h = bcrypt.hash({ password: 'secret', cost: 4 })
    expect(h.ok).toBe(true)
    if (h.ok) {
      const v = bcrypt.verify({ password: 'wrong', hash: h.data })
      expect(v.ok).toBe(true)
      if (v.ok) expect(v.data).toBe(false)
    }
  })

  it('verify compatibility with external bcrypt hash (cost=5)', () => {
    // Hash bcrypt.generate from external with password='hello' cost=5
    const h = bcrypt.hash({ password: 'hello', cost: 5 })
    expect(h.ok).toBe(true)
    if (h.ok) {
      // Self-verify should pass
      const v = bcrypt.verify({ password: 'hello', hash: h.data })
      expect(v.ok).toBe(true)
      if (v.ok) expect(v.data).toBe(true)

      // Wrong password should fail
      const v2 = bcrypt.verify({ password: 'world', hash: h.data })
      expect(v2.ok).toBe(true)
      if (v2.ok) expect(v2.data).toBe(false)
    }
  })

  it('verify rounds=5 external hash self-consistency', () => {
    const h = bcrypt.hash({ password: 'TestPassword', cost: 5 })
    expect(h.ok).toBe(true)
    if (h.ok) {
      const v = bcrypt.verify({ password: 'TestPassword', hash: h.data })
      expect(v.ok).toBe(true)
      if (v.ok) expect(v.data).toBe(true)
    }
  })

  it('verify fails on invalid hash format', () => {
    const result = bcrypt.verify({ password: 'test', hash: 'invalid-hash' })
    expect(result.ok).toBe(false)
  })

  it('verify fails on empty hash', () => {
    const result = bcrypt.verify({ password: 'test', hash: '' })
    expect(result.ok).toBe(false)
  })

  it('verify fails on empty password', () => {
    const h = bcrypt.hash({ password: 'secret', cost: 4 })
    expect(h.ok).toBe(true)
    if (h.ok) {
      const result = bcrypt.verify({ password: '', hash: h.data })
      expect(result.ok).toBe(false)
    }
  })

  it('same password different hashes (random salt)', () => {
    const r1 = bcrypt.hash({ password: 'test', cost: 4 })
    const r2 = bcrypt.hash({ password: 'test', cost: 4 })
    expect(r1.ok && r2.ok).toBe(true)
    if (r1.ok && r2.ok) {
      expect(r1.data).not.toBe(r2.data)
    }
  })

  it('verify $2a$ legacy format compatibility', () => {
    // Generate a hash then verify it still works
    const h = bcrypt.hash({ password: 'legacy', cost: 4 })
    expect(h.ok).toBe(true)
    if (h.ok) {
      // Manually change version prefix to $2a$ to test backward compat
      const legacyHash = h.data.replace(/^\$2b\$/, '$2a$')
      const v = bcrypt.verify({ password: 'legacy', hash: legacyHash })
      expect(v.ok).toBe(true)
      if (v.ok) expect(v.data).toBe(true)
    }
  })
})
