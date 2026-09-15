import { afterEach, describe, expect, it, vi } from 'vitest'
import { iconFileName, saveAsset } from './exporter'

describe('iconFileName', () => {
  const icon = {
    id: 'material-symbols:home/outline',
    prefix: 'material-symbols',
    name: 'home/outline',
    collectionName: 'Material Symbols',
    palette: false
  }

  it('creates filesystem-safe SVG names', () => {
    expect(iconFileName(icon, 'svg')).toBe('material-symbols-home-outline.svg')
  })

  it('uses the selected output extension', () => {
    expect(iconFileName(icon, 'png')).toBe('material-symbols-home-outline.png')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('saves SVG text through the ZTools preload bridge', () => {
    const saveTextFile = vi.fn().mockReturnValue('C:/icons/home.svg')
    vi.stubGlobal('window', {
      iconServices: {
        saveTextFile,
        saveBase64File: vi.fn()
      }
    })

    const savedPath = saveAsset(icon, 'svg', '<svg />')

    expect(savedPath).toBe('C:/icons/home.svg')
    expect(saveTextFile).toHaveBeenCalledWith('material-symbols-home-outline.svg', '<svg />')
  })

  it('saves PNG data through the ZTools preload bridge', () => {
    const saveBase64File = vi.fn().mockReturnValue('C:/icons/home.png')
    vi.stubGlobal('window', {
      iconServices: {
        saveTextFile: vi.fn(),
        saveBase64File
      }
    })

    const savedPath = saveAsset(icon, 'png', '<svg />', 'data:image/png;base64,AA==')

    expect(savedPath).toBe('C:/icons/home.png')
    expect(saveBase64File).toHaveBeenCalledWith(
      'material-symbols-home-outline.png',
      'data:image/png;base64,AA=='
    )
  })
})
