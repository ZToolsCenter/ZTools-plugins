import { describe, expect, it, vi } from 'vitest'
import { runCodec } from './codec'

describe('runCodec', () => {
  it('returns ok data', () => {
    vi.stubGlobal('window', {
      services: { crypt: { base64: { encode: () => ({ ok: true, data: 'X' }) } } }
    })
    expect(runCodec(() => window.services.crypt.base64.encode('a'))).toEqual({
      ok: true,
      data: 'X'
    })
    vi.unstubAllGlobals()
  })

  it('passes through failure', () => {
    vi.stubGlobal('window', {
      services: {
        crypt: { base64: { decode: () => ({ ok: false, error: 'Base64 格式无效' }) } }
      }
    })
    expect(runCodec(() => window.services.crypt.base64.decode('@'))).toEqual({
      ok: false,
      error: 'Base64 格式无效'
    })
    vi.unstubAllGlobals()
  })
})
