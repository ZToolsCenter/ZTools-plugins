import { describe, it, expect } from 'vitest'
import { mapQualityToRaster } from '../Compress/index'

describe('mapQualityToRaster (re-export)', () => {
  it('exposes dpi-based GS screen→ebook curve', () => {
    const low = mapQualityToRaster(10)
    const mid = mapQualityToRaster(50)
    const high = mapQualityToRaster(100)
    expect(low.dpi).toBeLessThan(mid.dpi)
    expect(mid.dpi).toBeLessThan(high.dpi)
    expect(high.dpi).toBe(150)
    expect(low.jpegQuality).toBeLessThan(high.jpegQuality)
  })
})
