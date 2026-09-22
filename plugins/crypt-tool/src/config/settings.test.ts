import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AlgorithmModule } from '../registry/types'
import { defaultSettings, loadSettings, saveSettings, setEnabled, SETTINGS_KEY } from './settings'

const mods = [
  {
    meta: {
      id: 'aes',
      category: 'symmetric',
      label: 'AES',
      title: 'AES 对称加密',
      reversible: true,
      cmds: ['aes加密'],
      defaultEnabled: true,
      teach: { summary: 's' }
    },
    Component: () => null
  },
  {
    meta: {
      id: 'rsa',
      category: 'asymmetric',
      label: 'RSA',
      title: 'RSA 非对称加密',
      reversible: true,
      cmds: ['rsa加密'],
      defaultEnabled: false,
      teach: { summary: 's' }
    },
    Component: () => null
  }
] as AlgorithmModule[]

describe('settings', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('window', {
      ztools: {
        dbStorage: {
          getItem: (k: string) => (store.has(k) ? JSON.parse(store.get(k)!) : null),
          setItem: (k: string, v: unknown) => {
            store.set(k, JSON.stringify(v))
          },
          removeItem: (k: string) => {
            store.delete(k)
          }
        }
      }
    })
  })

  it('defaults from module defaultEnabled', () => {
    const s = defaultSettings(mods)
    expect(s.enabled).toEqual({ aes: true, rsa: false })
  })

  it('loads saved settings and ignores unknown ids', () => {
    saveSettings({
      enabled: { aes: false, unknownId: true },
      prefs: { defaultOutputEncoding: 'base64' }
    })
    const s = loadSettings(mods)
    expect(s.enabled.aes).toBe(false)
    expect(s.enabled.unknownId).toBeUndefined()
    expect(s.enabled.rsa).toBe(false)
  })

  it('setEnabled persists', () => {
    const s = setEnabled('aes', false, mods)
    expect(s.enabled.aes).toBe(false)
    expect(loadSettings(mods).enabled.aes).toBe(false)
  })

  it('uses SETTINGS_KEY', () => {
    expect(SETTINGS_KEY).toBe('crypt-tool:settings')
  })
})
