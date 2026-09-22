import { describe, expect, it } from 'vitest'
import { md5, sha256 } from './index.js'

describe('hash', () => {
  it('md5 known vector', () => {
    expect(md5.digest('abc')).toEqual({
      ok: true,
      data: '900150983cd24fb0d6963f7d28e17f72'
    })
  })

  it('sha256 known vector', () => {
    expect(sha256.digest('abc')).toEqual({
      ok: true,
      data: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    })
  })
})
