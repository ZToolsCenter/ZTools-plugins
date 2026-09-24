/**
 * Pure layout helpers for watermark placement.
 * Shared concept with public/preload/services.js (kept in sync manually).
 */

export interface RotatedBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

/** Axis-aligned bounds of a rectangle (w×h) rotated around origin (0,0) CCW. */
export function rotatedTextBounds(textW: number, textH: number, rotationDeg: number): RotatedBounds {
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const corners: [number, number][] = [
    [0, 0],
    [textW, 0],
    [textW, textH],
    [0, textH],
  ]
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of corners) {
    const rx = x * cos - y * sin
    const ry = x * sin + y * cos
    if (rx < minX) minX = rx
    if (ry < minY) minY = ry
    if (rx > maxX) maxX = rx
    if (ry > maxY) maxY = ry
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

/**
 * Place watermark so the rotated text's bounding box stays fully on-page.
 * pdf-lib drawText rotates around (x,y) = baseline origin (bottom-left of unrotated text).
 */
export function positionToXYRotated(
  pos: string,
  pageW: number,
  pageH: number,
  textW: number,
  textH: number,
  margin: number,
  rotationDeg: number,
): { x: number; y: number } {
  const bounds = rotatedTextBounds(textW, textH, rotationDeg)
  const m = Math.max(0, Number(margin) || 0)
  const boxW = bounds.width
  const boxH = bounds.height
  const innerW = Math.max(0, pageW - 2 * m)
  const innerH = Math.max(0, pageH - 2 * m)

  const clampL = (v: number) => {
    if (boxW >= innerW) return m + (innerW - boxW) / 2
    return Math.min(Math.max(v, m), pageW - m - boxW)
  }
  const clampB = (v: number) => {
    if (boxH >= innerH) return m + (innerH - boxH) / 2
    return Math.min(Math.max(v, m), pageH - m - boxH)
  }

  let L: number
  let B: number
  switch (pos) {
    case 'tl':
      L = m
      B = pageH - m - boxH
      break
    case 'tc':
      L = (pageW - boxW) / 2
      B = pageH - m - boxH
      break
    case 'tr':
      L = pageW - m - boxW
      B = pageH - m - boxH
      break
    case 'ml':
    case 'l':
      L = m
      B = (pageH - boxH) / 2
      break
    case 'mr':
    case 'r':
      L = pageW - m - boxW
      B = (pageH - boxH) / 2
      break
    case 'bl':
      L = m
      B = m
      break
    case 'bc':
      L = (pageW - boxW) / 2
      B = m
      break
    case 'br':
      L = pageW - m - boxW
      B = m
      break
    case 'mc':
    case 'c':
    default:
      L = (pageW - boxW) / 2
      B = (pageH - boxH) / 2
      break
  }

  L = clampL(L)
  B = clampB(B)
  return { x: L - bounds.minX, y: B - bounds.minY }
}

/**
 * Tile step sizes from density 1(疏)..5(密).
 * Higher density → smaller gaps between stamps.
 */
export function tileSteps(
  textW: number,
  textH: number,
  density: number,
): { stepX: number; stepY: number } {
  const d = Math.min(5, Math.max(1, Math.round(Number(density) || 3)))
  // gap multiplier: density1=1.8 … density5=0.35
  const gapMul = 1.8 - (d - 1) * 0.3625
  const gapX = Math.max(textW * 0.55, 36) * gapMul
  const gapY = Math.max(textH * 1.4, 48) * gapMul
  return {
    stepX: Math.max(textW + gapX, 48),
    stepY: Math.max(textH + gapY, 40),
  }
}
