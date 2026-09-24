import { describe, expect, it } from 'vitest'
import { base64, hex, url } from './index.js'

describe('base64', () => {
  it('roundtrips UTF-8 text', () => {
    const enc = base64.encode('Hello ZTools')
    expect(enc.ok).toBe(true)
    if (!enc.ok) return
    expect(enc.data).toBe('SGVsbG8gWlRvb2xz')
    const dec = base64.decode(enc.data)
    expect(dec).toEqual({ ok: true, data: 'Hello ZTools' })
  })

  it('fails on invalid base64', () => {
    const dec = base64.decode('@@@')
    expect(dec.ok).toBe(false)
    if (dec.ok) return
    expect(dec.error).toMatch(/Base64/)
  })
})

describe('hex', () => {
  it('encodes and decodes', () => {
    const enc = hex.encode('AB')
    expect(enc).toEqual({ ok: true, data: '4142' })
    expect(hex.decode('4142')).toEqual({ ok: true, data: 'AB' })
  })

  it('fails on odd-length hex', () => {
    const r = hex.decode('414')
    expect(r.ok).toBe(false)
  })
})

describe('url', () => {
  it('roundtrips', () => {
    const enc = url.encode('a b/c?d=e')
    expect(enc.ok).toBe(true)
    if (!enc.ok) return
    expect(url.decode(enc.data)).toEqual({ ok: true, data: 'a b/c?d=e' })
  })
})
