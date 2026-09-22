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

  it('ships ten batch-1 algorithms in order', () => {
    expect(algorithms.map((m) => m.meta.id)).toEqual([
      'base64', 'hex', 'url', 'md5', 'sha256', 'aes', 'rsa', 'hmac', 'pbkdf2', 'bcrypt'
    ])
    expect(algorithms.every((m) => m.meta.defaultEnabled)).toBe(true)
  })
})
