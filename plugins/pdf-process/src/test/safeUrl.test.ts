import { describe, it, expect } from 'vitest'
import { assertSafeExternalUrl, isSafeExternalUrl } from '../utils/safeUrl'

describe('safeUrl', () => {
  it('allows https', () => {
    expect(assertSafeExternalUrl('https://example.com/x')).toBe('https://example.com/x')
    expect(isSafeExternalUrl('https://a.com')).toBe(true)
  })

  it('rejects non-https', () => {
    expect(() => assertSafeExternalUrl('http://example.com')).toThrow(/https/)
    expect(() => assertSafeExternalUrl('file:///tmp/x')).toThrow(/https/)
    expect(() => assertSafeExternalUrl('javascript:alert(1)')).toThrow()
    expect(isSafeExternalUrl('http://a.com')).toBe(false)
  })
})
