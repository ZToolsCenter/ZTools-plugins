import { describe, expect, it } from 'vitest'
import { CATEGORIES, categoryLabel } from './categories'

describe('categories', () => {
  it('has six categories in spec order', () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual([
      'encoding',
      'hash',
      'symmetric',
      'asymmetric',
      'hmac',
      'kdf'
    ])
  })

  it('maps Chinese labels', () => {
    expect(categoryLabel('encoding')).toBe('编码转换')
    expect(categoryLabel('kdf')).toBe('口令派生')
  })
})
