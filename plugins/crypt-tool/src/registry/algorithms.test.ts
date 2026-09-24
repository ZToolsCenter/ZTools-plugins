import { describe, expect, it } from 'vitest'
import type { AlgorithmModule } from './types'
import { algorithms, firstEnabledId, getByCategory, getById, getEnabledList } from './algorithms'

const m = (id: string, category: AlgorithmModule['meta']['category'], on: boolean): AlgorithmModule => ({
  meta: {
    id,
    category,
    label: id.toUpperCase(),
    title: id,
    reversible: false,
    cmds: [id],
    defaultEnabled: on,
    teach: { summary: '' }
  },
  Component: () => null
})

const list = [m('base64', 'encoding', true), m('aes', 'symmetric', true), m('rsa', 'asymmetric', false)]

describe('registry helpers', () => {
  it('filters enabled', () => {
    expect(getEnabledList(list, { base64: true, aes: false, rsa: true }).map((x) => x.meta.id)).toEqual([
      'base64',
      'rsa'
    ])
  })

  it('firstEnabledId', () => {
    expect(firstEnabledId(list, { base64: false, aes: true, rsa: true })).toBe('aes')
    expect(firstEnabledId(list, { base64: false, aes: false, rsa: false })).toBeNull()
  })

  it('getById / getByCategory', () => {
    expect(getById(list, 'aes')?.meta.id).toBe('aes')
    expect(getByCategory(list, 'encoding').map((x) => x.meta.id)).toEqual(['base64'])
  })

  it('ships all algorithms in order', () => {
    expect(algorithms.map((m) => m.meta.id)).toEqual([
      'base64', 'base58', 'unicodeEscape', 'htmlEntity', 'punycode', 'morse', 'hex', 'url', 'md5', 'sha1', 'sha256', 'sha512', 'sha384', 'sha3_256', 'sha3_512', 'ripemd160',
      'aes', 'xorStream', 'chacha', 'des',
      'rsa', 'ecdsa', 'ecdh', 'ed25519',
      'hmac', 'pbkdf2', 'bcrypt', 'scrypt', 'argon2', 'hkdf',
      'jwt', 'json', 'passwordStrength',
      'uuid', 'crc32', 'adler32', 'randomBytes', 'safeBase64', 'base32'
    ])
    // argon2 defaults disabled (needs native module)
    expect(algorithms.filter((m) => !m.meta.defaultEnabled).map((m) => m.meta.id)).toEqual(['argon2'])
  })
})
