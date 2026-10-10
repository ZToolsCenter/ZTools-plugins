import { describe, expect, it, vi } from 'vitest'
import type { AlgorithmModule, AlgorithmMeta } from '../registry/types'
import { buildFeature, syncFeatures } from './features'

const meta: AlgorithmMeta = {
  id: 'aes',
  category: 'symmetric',
  label: 'AES',
  title: 'AES 对称加密',
  reversible: true,
  cmds: ['aes加密', 'AES'],
  defaultEnabled: true,
  teach: { summary: 's' }
}

const mods = [{ meta, Component: () => null }] as AlgorithmModule[]

describe('features', () => {
  it('buildFeature shape', () => {
    expect(buildFeature(meta)).toEqual({
      code: 'alg:aes',
      explain: 'AES 对称加密',
      icon: 'logo.svg',
      cmds: ['aes加密', 'AES']
    })
  })

  it('syncFeatures set/remove targets', () => {
    const setFeature = vi.fn()
    const removeFeature = vi.fn()
    vi.stubGlobal('window', { ztools: { setFeature, removeFeature } })

    syncFeatures(mods, { aes: true })
    expect(setFeature).toHaveBeenCalledWith(buildFeature(meta))
    expect(removeFeature).not.toHaveBeenCalled()

    setFeature.mockClear()
    syncFeatures(mods, { aes: false })
    expect(removeFeature).toHaveBeenCalledWith('alg:aes')
    expect(setFeature).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('throws are caught by syncFeatures', () => {
    const setFeature = vi.fn(() => {
      throw new Error('host error')
    })
    const removeFeature = vi.fn(() => {
      throw new Error('host error')
    })
    vi.stubGlobal('window', { ztools: { setFeature, removeFeature } })
    expect(() => syncFeatures(mods, { aes: true })).not.toThrow()
    vi.unstubAllGlobals()
  })
})
