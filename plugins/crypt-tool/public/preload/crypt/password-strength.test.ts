import { describe, expect, it } from 'vitest'
import { analyze } from './password-strength'

describe('password-strength', () => {
  it('scores empty password as 0', () => {
    const r = analyze({ password: '' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.score).toBe(0)
  })

  it('short numeric password is weak', () => {
    const r = analyze({ password: '123456' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.label).toBe('弱')
      expect(r.data.score).toBeLessThan(50)
    }
  })

  it('strong mixed password scores high', () => {
    const r = analyze({ password: 'MyP@ssw0rd!#2024' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.score).toBeGreaterThan(60)
    }
  })

  it('reports character type flags', () => {
    const r = analyze({ password: 'Abc123!@#' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.hasLower).toBe(true)
      expect(r.data.hasUpper).toBe(true)
      expect(r.data.hasDigit).toBe(true)
      expect(r.data.hasSymbol).toBe(true)
    }
  })

  it('penalizes common patterns', () => {
    const common = analyze({ password: 'password123456' })
    const strong = analyze({ password: 'X#9mK$pL!qR2vN8wZ' })
    if (common.ok && strong.ok) {
      expect(common.data.score).toBeLessThan(strong.data.score)
    }
  })
})
