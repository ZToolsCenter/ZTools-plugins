import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { sanitizeSettings, loadSettings, saveSettings } = require('../../lib/settings-store.js')

describe('sanitizeSettings', () => {
  it('drops unknown and secret fields', () => {
    const out = sanitizeSettings({
      aiApiKey: 'sk-x',
      defaultQuality: 'high',
      webConvertLinks: {
        word: [{ name: 'ok', url: 'https://example.com' }],
      },
    })
    expect(out.aiApiKey).toBeUndefined()
    expect(out.defaultQuality).toBeUndefined()
    expect(out.webConvertLinks.word).toEqual([{ name: 'ok', url: 'https://example.com' }])
  })

  it('filters non-https links', () => {
    const out = sanitizeSettings({
      webConvertLinks: {
        word: [
          { name: 'a', url: 'https://a.com' },
          { name: 'b', url: 'http://b.com' },
        ],
      },
    })
    expect(out.webConvertLinks.word).toEqual([{ name: 'a', url: 'https://a.com' }])
  })
})

describe('load/saveSettings', () => {
  it('round-trips via dbStorage mock', () => {
    const store = new Map()
    const db = {
      getItem: (k) => store.get(k),
      setItem: (k, v) => store.set(k, v),
    }
    saveSettings(db, {
      webConvertLinks: { word: [{ name: 'x', url: 'https://x.com' }], excel: [], ppt: [] },
      junk: 1,
    })
    const loaded = loadSettings(db)
    expect(loaded.webConvertLinks.word).toEqual([{ name: 'x', url: 'https://x.com' }])
    expect(loaded.junk).toBeUndefined()
  })
})
