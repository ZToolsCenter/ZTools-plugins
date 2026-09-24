import { describe, expect, it } from 'vitest'
import { CATEGORIES, categoryLabel } from './categories'

describe('categories', () => {
  it('has seven categories in spec order', () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual([
      'encoding',
      'hash',
      'symmetric',
      'asymmetric',
      'hmac',
      'kdf',
      'tools'
    ])
  })

  it('maps Chinese labels', () => {
    expect(categoryLabel('encoding')).toBe('编码转换')
    expect(categoryLabel('kdf')).toBe('口令派生')
    expect(categoryLabel('tools')).toBe('工具与实用')
  })
})
