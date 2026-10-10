import { describe, expect, it } from 'vitest'
import { generate } from './random-bytes'

describe('random-bytes', () => {
  it('generates 32 hex bytes by default', () => {
    const r = generate({})
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('generates specified length', () => {
    const r = generate({ length: 16, encoding: 'hex' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toMatch(/^[0-9a-f]{32}$/)
  })

  it('base64 encoding works', () => {
    const r = generate({ length: 32, encoding: 'base64' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })

  it('base64url encoding works', () => {
    const r = generate({ length: 32, encoding: 'base64url' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('two calls produce different output', () => {
    const a = generate({ length: 32 })
    const b = generate({ length: 32 })
    if (a.ok && b.ok) expect(a.data).not.toBe(b.data)
  })

  it('rejects invalid length', () => {
    const r = generate({ length: 0 })
    expect(r.ok).toBe(false)
  })

  it('rejects too-large length', () => {
    const r = generate({ length: 9999 })
    expect(r.ok).toBe(false)
  })
})
