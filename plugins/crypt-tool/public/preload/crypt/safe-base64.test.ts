import { describe, expect, it } from 'vitest'
import { urlSafeBase64Encode, urlSafeBase64Decode } from './safe-base64'

describe('safe-base64', () => {
  it('encode produces output without + or /', () => {
    // Verify the core URL-safe property: output never contains + or /
    const inputs = ['hello world!?', 'testdata>>>', '??????', 'abc\xff\xfe']
    for (const input of inputs) {
      const r = urlSafeBase64Encode({ input })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.data).not.toContain('+')
        expect(r.data).not.toContain('/')
      }
    }
  })

  it('encode + decode round trip with padding', () => {
    const input = 'Hello URL-safe Base64! 你好世界'
    const enc = urlSafeBase64Encode({ input })
    expect(enc.ok).toBe(true)
    if (enc.ok) {
      const dec = urlSafeBase64Decode({ input: enc.data })
      expect(dec.ok).toBe(true)
      if (dec.ok) expect(dec.data).toBe(input)
    }
  })

  it('encode + decode round trip without padding', () => {
    const input = 'test data for url safe'
    const enc = urlSafeBase64Encode({ input, stripPadding: true })
    expect(enc.ok).toBe(true)
    if (enc.ok) {
      expect(enc.data).not.toContain('=')
      const dec = urlSafeBase64Decode({ input: enc.data })
      expect(dec.ok).toBe(true)
      if (dec.ok) expect(dec.data).toBe(input)
    }
  })

  it('decode handles missing padding', () => {
    const dec = urlSafeBase64Decode({ input: 'SGVsbG8' })
    expect(dec.ok).toBe(true)
    if (dec.ok) expect(dec.data).toBe('Hello')
  })

  it('handles empty string', () => {
    const enc = urlSafeBase64Encode({ input: '' })
    expect(enc.ok).toBe(true)
    if (enc.ok) expect(enc.data).toBe('')
  })
})
