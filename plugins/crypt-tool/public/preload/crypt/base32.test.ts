import { describe, expect, it } from 'vitest'
import { base32Encode, base32Decode } from './base32'

describe('base32', () => {
  it('encode "f"', () => {
    const r = base32Encode({ input: 'f' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toBe('MY======')
  })

  it('encode "fo"', () => {
    const r = base32Encode({ input: 'fo' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toBe('MZXQ====')
  })

  it('encode "foo"', () => {
    const r = base32Encode({ input: 'foo' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toBe('MZXW6===')
  })

  it('encode without padding', () => {
    const r = base32Encode({ input: 'foo', padding: false })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toBe('MZXW6')
      expect(r.data).not.toContain('=')
    }
  })

  it('decode "MZXW6==="', () => {
    const r = base32Decode({ input: 'MZXW6===' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toBe('foo')
  })

  it('encode + decode round trip', () => {
    const input = 'Base32 encoding test 12345'
    const enc = base32Encode({ input, padding: true })
    expect(enc.ok).toBe(true)
    if (enc.ok) {
      const dec = base32Decode({ input: enc.data })
      expect(dec.ok).toBe(true)
      if (dec.ok) expect(dec.data).toBe(input)
    }
  })

  it('handles case insensitivity', () => {
    const a = base32Decode({ input: 'nzxw6ytboi======' })
    const b = base32Decode({ input: 'NZXW6YTBOI======' })
    if (a.ok && b.ok) expect(a.data).toBe(b.data)
  })

  it('empty string', () => {
    const enc = base32Encode({ input: '' })
    expect(enc.ok).toBe(true)
    if (enc.ok) expect(enc.data).toBe('')
  })
})
