import { describe, expect, it } from 'vitest'
import { encode, decode } from './punycode-idn'

describe('punycode', () => {
  it('encodes unicode domain', () => {
    const r = encode({ input: '测试.com' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toBe('xn--0zwm56d.com')
  })

  it('decodes punycode domain', () => {
    const r = decode({ input: 'xn--0zwm56d.com' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toBe('测试.com')
  })

  it('ascii domain passes through unchanged', () => {
    const r = encode({ input: 'example.com' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toBe('example.com')
  })

  it('round trip', () => {
    const orig = '中国.cn'
    const enc = encode({ input: orig })
    expect(enc.ok).toBe(true)
    if (enc.ok) {
      const dec = decode({ input: enc.data })
      expect(dec.ok).toBe(true)
      if (dec.ok) expect(dec.data).toBe(orig)
    }
  })
})
