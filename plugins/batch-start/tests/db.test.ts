import { describe, it, expect } from 'vitest'
import { makeAppId, makeCategoryId, makeGroupId } from '../src/services/db'

describe('id factories', () => {
  it('prefixes ids', () => {
    expect(makeAppId('abc')).toBe('app:abc')
    expect(makeCategoryId('abc')).toBe('category:abc')
    expect(makeGroupId('abc')).toBe('group:abc')
  })
})
