/**
 * Pure watermark layout helpers (shared concept with src/utils/watermarkLayout.ts).
 */
function hexToRgb01(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || '').trim())
  if (!m) return { r: 0.5, g: 0.5, b: 0.5 }
  const n = parseInt(m[1], 16)
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  }
}

/** Axis-aligned bounds of a w×h rect rotated around origin (0,0) CCW. */
function rotatedTextBounds(textW, textH, rotationDeg) {
  const rad = (Number(rotationDeg) || 0) * Math.PI / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const corners = [[0, 0], [textW, 0], [textW, textH], [0, textH]]
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
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
 * Place watermark so the rotated text bounding box stays fully on-page.
 * pdf-lib drawText rotates around (x,y) = baseline origin.
 */
function positionToXY(pos, pageW, pageH, textW, textH, margin, rotationDeg) {
  const bounds = rotatedTextBounds(textW, textH, rotationDeg)
  const m = Math.max(0, Number(margin) || 0)
  const boxW = bounds.width
  const boxH = bounds.height
  const innerW = Math.max(0, pageW - 2 * m)
  const innerH = Math.max(0, pageH - 2 * m)

  const clampL = (v) => {
    if (boxW >= innerW) return m + (innerW - boxW) / 2
    return Math.min(Math.max(v, m), pageW - m - boxW)
  }
  const clampB = (v) => {
    if (boxH >= innerH) return m + (innerH - boxH) / 2
    return Math.min(Math.max(v, m), pageH - m - boxH)
  }

  let L, B
  switch (pos) {
    case 'tl': L = m; B = pageH - m - boxH; break
    case 'tc': L = (pageW - boxW) / 2; B = pageH - m - boxH; break
    case 'tr': L = pageW - m - boxW; B = pageH - m - boxH; break
    case 'ml':
    case 'l': L = m; B = (pageH - boxH) / 2; break
    case 'mr':
    case 'r': L = pageW - m - boxW; B = (pageH - boxH) / 2; break
    case 'bl': L = m; B = m; break
    case 'bc': L = (pageW - boxW) / 2; B = m; break
    case 'br': L = pageW - m - boxW; B = m; break
    case 'mc':
    case 'c':
    default: L = (pageW - boxW) / 2; B = (pageH - boxH) / 2; break
  }
  L = clampL(L)
  B = clampB(B)
  return { x: L - bounds.minX, y: B - bounds.minY }
}

/** density 1(疏)..5(密) → tile step sizes */
function tileSteps(textW, textH, density) {
  const d = Math.min(5, Math.max(1, Math.round(Number(density) || 3)))
  const gapMul = 1.8 - (d - 1) * 0.3625
  const gapX = Math.max(textW * 0.55, 36) * gapMul
  const gapY = Math.max(textH * 1.4, 48) * gapMul
  return {
    stepX: Math.max(textW + gapX, 48),
    stepY: Math.max(textH + gapY, 40),
  }
}

module.exports = {
  hexToRgb01,
  rotatedTextBounds,
  positionToXY,
  tileSteps,
};
