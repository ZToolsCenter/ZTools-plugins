import { describe, it, expect } from 'vitest'
import {
  mapQualityToRaster,
  computeRasterPixelSize,
  applyLongEdgeCap,
  clampQuality,
  STRONG_MAX_LONG_EDGE_PX,
} from '../utils/strongCompress'

describe('mapQualityToRaster (GS screen→ebook)', () => {
  it('stays within Ghostscript screen–ebook DPI band', () => {
    const low = mapQualityToRaster(1)
    const mid = mapQualityToRaster(50)
    const high = mapQualityToRaster(100)
    expect(low.dpi).toBe(72)
    expect(high.dpi).toBe(150)
    expect(mid.dpi).toBeGreaterThan(low.dpi)
    expect(mid.dpi).toBeLessThan(high.dpi)
    expect(high.dpi).toBeLessThanOrEqual(150)
  })

  it('raises jpeg quality with slider but stays lossy', () => {
    const low = mapQualityToRaster(10)
    const high = mapQualityToRaster(100)
    expect(low.jpegQuality).toBeLessThan(high.jpegQuality)
    expect(high.jpegQuality).toBeLessThanOrEqual(0.75)
    expect(low.jpegQuality).toBeGreaterThanOrEqual(0.3)
  })

  it('uses grayscale only on low quality (aggressive screen)', () => {
    expect(mapQualityToRaster(20).grayscale).toBe(true)
    expect(mapQualityToRaster(50).grayscale).toBe(false)
  })
})

describe('computeRasterPixelSize', () => {
  it('maps letter page at 72dpi to ~612×792 px', () => {
    const letter = { widthPt: 612, heightPt: 792 }
    const r = computeRasterPixelSize(letter, 72)
    expect(r.widthPx).toBe(612)
    expect(r.heightPx).toBe(792)
    expect(r.scale).toBe(1)
  })

  it('maps letter page at 150dpi (ebook) to ~2.08× CSS size', () => {
    const letter = { widthPt: 612, heightPt: 792 }
    const r = computeRasterPixelSize(letter, 150)
    expect(r.scale).toBeCloseTo(150 / 72, 5)
    expect(r.widthPx).toBe(Math.round(612 * (150 / 72)))
    expect(r.heightPx).toBe(Math.round(792 * (150 / 72)))
    // ebook letter long edge ~1650px — under our 2000 cap
    expect(Math.max(r.widthPx, r.heightPx)).toBeLessThanOrEqual(STRONG_MAX_LONG_EDGE_PX)
  })

  it('does not use pixel-as-point fallacy: page pts independent of px', () => {
    const page = { widthPt: 612, heightPt: 792 }
    const r = computeRasterPixelSize(page, 100)
    // Reconstructed page must keep 612×792 pts even though px differ
    expect(page.widthPt).toBe(612)
    expect(r.widthPx).not.toBe(page.widthPt)
  })
})

describe('applyLongEdgeCap', () => {
  it('scales both axes when over cap', () => {
    const big = { widthPx: 4000, heightPx: 6000, scale: 4 }
    const capped = applyLongEdgeCap(big, 2000)
    expect(Math.max(capped.widthPx, capped.heightPx)).toBe(2000)
    expect(capped.widthPx / capped.heightPx).toBeCloseTo(big.widthPx / big.heightPx, 2)
  })

  it('is no-op under cap', () => {
    const s = { widthPx: 800, heightPx: 600, scale: 1 }
    expect(applyLongEdgeCap(s, 2000)).toEqual(s)
  })
})

describe('clampQuality', () => {
  it('clamps', () => {
    expect(clampQuality(-5)).toBe(1)
    expect(clampQuality(200)).toBe(100)
    expect(clampQuality(40)).toBe(40)
  })
})
