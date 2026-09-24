import { describe, expect, it } from 'vitest'
import { encode, decode } from './html-entity'

describe('html-entity', () => {
  it('encode special chars to hex entities', () => {
    const r = encode({ input: '<b>Héllo</b>', useNamed: false })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toContain('&#x3C;')
      expect(r.data).toContain('&#x3E;')
    }
  })

  it('encode with named entities when enabled', () => {
    const r = encode({ input: 'A & B < C', useNamed: true })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toContain('&amp;')
      expect(r.data).toContain('&lt;')
    }
  })

  it('decode named entities', () => {
    const r = decode({ input: '&lt;div&gt;Hello &amp; World&lt;/div&gt;' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toBe('<div>Hello & World</div>')
  })

  it('decode hex entities', () => {
    const r = decode({ input: '&#x3C;test&#x3E;' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toBe('<test>')
  })

  it('decode decimal entities', () => {
    const r = decode({ input: '&#60;test&#62;' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toBe('<test>')
  })

  it('round trip', () => {
    const orig = '<h1>"Hello" & \'World\'</h1>'
    const enc = encode({ input: orig, useNamed: false })
    expect(enc.ok).toBe(true)
    if (enc.ok) {
      const dec = decode({ input: enc.data })
      expect(dec.ok).toBe(true)
      if (dec.ok) expect(dec.data).toBe(orig)
    }
  })
})
