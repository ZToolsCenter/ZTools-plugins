import { describe, expect, it } from 'vitest'
const { md5, sha1, sha256, sha384, sha512, sha3_256, sha3_512, ripemd160 } = require('./index.js')

describe('hash', () => {
  it('md5 known vector "abc"', () => {
    expect(md5.digest('abc')).toEqual({
      ok: true,
      data: '900150983cd24fb0d6963f7d28e17f72'
    })
  })

  it('sha1 known vector "abc"', () => {
    expect(sha1.digest('abc')).toEqual({
      ok: true,
      data: 'a9993e364706816aba3e25717850c26c9cd0d89d'
    })
  })

  it('sha256 known vector "abc"', () => {
    expect(sha256.digest('abc')).toEqual({
      ok: true,
      data: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    })
  })

  it('sha384 known vector "abc"', () => {
    expect(sha384.digest('abc')).toEqual({
      ok: true,
      data: 'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7'
    })
  })

  it('sha512 known vector "abc"', () => {
    expect(sha512.digest('abc')).toEqual({
      ok: true,
      data: 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f'
    })
  })

  it('sha3-256 known vector "abc"', () => {
    const r = sha3_256.digest('abc')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.length).toBe(64)
      expect(r.data).toBe('3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532')
    }
  })

  it('sha3-512 known vector "abc"', () => {
    const r = sha3_512.digest('abc')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.length).toBe(128)
    }
  })

  it('ripemd160 known vector "abc"', () => {
    const r = ripemd160.digest('abc')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toBe('8eb208f7e05d987a9b044a8e98c6b087f15a0bfc')
    }
  })

  it('empty string sha256', () => {
    expect(sha256.digest('')).toEqual({
      ok: true,
      data: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    })
  })
})
