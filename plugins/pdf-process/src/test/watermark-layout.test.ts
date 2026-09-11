import { describe, it, expect } from 'vitest'
import { positionToXYRotated, rotatedTextBounds, tileSteps } from '../utils/watermarkLayout'

describe('rotatedTextBounds', () => {
  it('unrotated matches original size', () => {
    const b = rotatedTextBounds(100, 20, 0)
    expect(b.width).toBeCloseTo(100, 5)
    expect(b.height).toBeCloseTo(20, 5)
    expect(b.minX).toBeCloseTo(0, 5)
    expect(b.minY).toBeCloseTo(0, 5)
  })

  it('90deg swaps extents', () => {
    const b = rotatedTextBounds(100, 20, 90)
    expect(b.width).toBeCloseTo(20, 5)
    expect(b.height).toBeCloseTo(100, 5)
  })
})

describe('positionToXYRotated keeps text fully on page', () => {
  const pageW = 600
  const pageH = 800
  const textW = 120
  const textH = 24
  const margin = 20

  function assertInside(pos: string, rotation: number) {
    const bounds = rotatedTextBounds(textW, textH, rotation)
    const { x, y } = positionToXYRotated(pos, pageW, pageH, textW, textH, margin, rotation)
    const left = x + bounds.minX
    const bottom = y + bounds.minY
    const right = x + bounds.maxX
    const top = y + bounds.maxY
    // allow tiny float error
    expect(left).toBeGreaterThanOrEqual(margin - 0.01)
    expect(bottom).toBeGreaterThanOrEqual(margin - 0.01)
    expect(right).toBeLessThanOrEqual(pageW - margin + 0.01)
    expect(top).toBeLessThanOrEqual(pageH - margin + 0.01)
  }

  const positions = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br']
  const rotations = [0, 30, 45, -45, 90, -90, 135]

  for (const pos of positions) {
    for (const rot of rotations) {
      it(`${pos} @ ${rot}° stays inside margin`, () => {
        assertInside(pos, rot)
      })
    }
  }
})

describe('tileSteps density', () => {
  it('higher density yields smaller steps', () => {
    const sparse = tileSteps(100, 20, 1)
    const mid = tileSteps(100, 20, 3)
    const dense = tileSteps(100, 20, 5)
    expect(sparse.stepX).toBeGreaterThan(mid.stepX)
    expect(mid.stepX).toBeGreaterThan(dense.stepX)
    expect(sparse.stepY).toBeGreaterThan(dense.stepY)
  })
})
