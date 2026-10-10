import { describe, expect, it } from 'vitest'
import { uuid, base58, base58check, crc32 } from './serde-utils'

describe('uuid', () => {
  it('generates valid v4 UUID format', () => {
    const r = uuid.v4()
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    }
  })

  it('generates unique UUIDs', () => {
    const a = uuid.v4()
    const b = uuid.v4()
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.data).not.toBe(b.data)
    }
  })

  it('generates v7 UUID with version marker', () => {
    const r = uuid.v7()
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    }
  })

  it('generate produces N UUIDs', () => {
    const r = uuid.generate({ version: 'v4', count: 5 })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const lines = r.data.split('\n')
      expect(lines.length).toBe(5)
      lines.forEach((id) => {
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      })
    }
  })
})

describe('base58', () => {
  it('encode + decode round trip', () => {
    const plain = 'Hello Base58!'
    const enc = base58.encode({ input: plain })
    expect(enc.ok).toBe(true)
    if (enc.ok) {
      const dec = base58.decode({ input: enc.data })
      expect(dec.ok).toBe(true)
      if (dec.ok) {
        expect(dec.data).toBe(plain)
      }
    }
  })

  it('encodes known value: "hello world"', () => {
    const r = base58.encode({ input: 'hello world' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toBe('StV1DL6CwTryKyV')
    }
  })

  it('decodes known value: "StV1DL6CwTryKyV"', () => {
    const r = base58.decode({ input: 'StV1DL6CwTryKyV' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toBe('hello world')
    }
  })

  it('single character round trip', () => {
    const enc = base58.encode({ input: 'A' })
    expect(enc.ok).toBe(true)
    if (enc.ok) {
      const dec = base58.decode({ input: enc.data })
      expect(dec.ok).toBe(true)
      if (dec.ok) {
        expect(dec.data).toBe('A')
      }
    }
  })

  it('rejects invalid characters', () => {
    const r = base58.decode({ input: '0OIl' })
    expect(r.ok).toBe(false)
  })
})

describe('base58check', () => {
  it('encode + decode round trip', () => {
    const hexInput = '00' + '9d1e01' + '7a8b9c'
    const enc = base58check.encode({ input: hexInput })
    expect(enc.ok).toBe(true)
    if (enc.ok) {
      const dec = base58check.decode({ input: enc.data })
      expect(dec.ok).toBe(true)
      if (dec.ok) {
        expect(dec.data.valid).toBe(true)
        expect(dec.data.data.startsWith('00')).toBe(true)
      }
    }
  })

  it('decode detects tampered checksum', () => {
    const enc = base58check.encode({ input: '009d1e017a8b9c' })
    expect(enc.ok).toBe(true)
    if (enc.ok) {
      const tampered = enc.data.slice(0, -1) + (enc.data.slice(-1) === '1' ? '2' : '1')
      const dec = base58check.decode({ input: tampered })
      expect(dec.ok).toBe(true)
      if (dec.ok) {
        expect(dec.data.valid).toBe(false)
      }
    }
  })

  it('rejects odd-length hex input', () => {
    const r = base58check.encode({ input: 'abc' })
    expect(r.ok).toBe(false)
  })

  it('rejects invalid hex characters', () => {
    const r = base58check.encode({ input: 'GGGG' })
    expect(r.ok).toBe(false)
  })
})

describe('crc32', () => {
  it('known vector: "abc" → 352441c2', () => {
    const r = crc32.checksum({ input: 'abc' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toBe('352441c2')
    }
  })

  it('empty string CRC32', () => {
    const r = crc32.checksum({ input: '' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toBe('00000000')
    }
  })

  it('consistency - same input same output', () => {
    const a = crc32.checksum({ input: 'hello' })
    const b = crc32.checksum({ input: 'hello' })
    if (a.ok && b.ok) {
      expect(a.data).toBe(b.data)
    }
  })

  it('different input different output', () => {
    const a = crc32.checksum({ input: 'hello' })
    const b = crc32.checksum({ input: 'world' })
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.data).not.toBe(b.data)
    }
  })

  it('known vector: "123456789" → cbf43926', () => {
    const r = crc32.checksum({ input: '123456789' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toBe('cbf43926')
    }
  })
})
