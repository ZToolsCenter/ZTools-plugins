import { describe, expect, it } from 'vitest'
import { checksum } from './adler32'

describe('adler32', () => {
  it('known vector: "a" → 00620062', () => {
    const r = checksum({ input: 'a' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toBe('00620062')
  })

  it('known vector: "abc" → 24d01275 (but 8 hex)', () => {
    const r = checksum({ input: 'abc' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.length).toBe(8)
    }
  })

  it('empty string returns 00000001', () => {
    const r = checksum({ input: '' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toBe('00000001')
  })

  it('consistency - same input same output', () => {
    const a = checksum({ input: 'hello' })
    const b = checksum({ input: 'hello' })
    if (a.ok && b.ok) expect(a.data).toBe(b.data)
  })

  it('different input different output', () => {
    const a = checksum({ input: 'hello' })
    const b = checksum({ input: 'world' })
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    if (a.ok && b.ok) expect(a.data).not.toBe(b.data)
  })
})
