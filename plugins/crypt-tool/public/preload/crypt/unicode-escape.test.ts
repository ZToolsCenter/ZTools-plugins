import { describe, expect, it } from 'vitest'
import { encode, decode } from './unicode-escape'

describe('unicode-escape', () => {
  it('encodes emoji', () => {
    expect(encode({ input: '😀' })).toEqual({ ok: true, data: '\\u{1f600}' })
  })

  it('encodes accented chars', () => {
    expect(encode({ input: 'é' })).toEqual({ ok: true, data: '\\u00e9' })
  })

  it('leaves ascii as-is', () => {
    expect(encode({ input: 'hello' })).toEqual({ ok: true, data: 'hello' })
  })

  it('decode \\u{1f600}', () => {
    expect(decode({ input: '\\u{1f600}' })).toEqual({ ok: true, data: '😀' })
  })

  it('decode \\u00e9', () => {
    expect(decode({ input: '\\u00e9' })).toEqual({ ok: true, data: 'é' })
  })

  it('round trip', () => {
    const orig = 'Hello 世界! 😀🎉'
    const enc = encode({ input: orig })
    expect(enc.ok).toBe(true)
    if (enc.ok) {
      const dec = decode({ input: enc.data })
      expect(dec.ok).toBe(true)
      if (dec.ok) expect(dec.data).toBe(orig)
    }
  })
})
