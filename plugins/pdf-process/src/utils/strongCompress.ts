/**
 * Strong-compress raster parameters.
 *
 * Modeled on Ghostscript PDFSETTINGS / OCRmyPDF practice:
 * - /screen  ≈ 72 dpi  (smallest, on-screen)
 * - /ebook   ≈ 150 dpi (balanced share/email)
 * - /printer ≈ 300 dpi (we deliberately stay ≤ ebook for "strong" mode)
 *
 * @see https://ghostscript.readthedocs.io/en/latest/VectorDevices.html
 * @see https://github.com/ocrmypdf/OCRmyPDF (ghostscript image downsample)
 */

export interface StrongRasterParams {
  /** Target raster DPI (pixels per inch). */
  dpi: number
  /** canvas/toDataURL JPEG quality 0–1. */
  jpegQuality: number
  /** Convert page to grayscale before JPEG (extra size win, GS Gray strategy). */
  grayscale: boolean
}

const PDF_USER_UNIT_DPI = 72

/** Clamp quality slider to 1–100. */
export function clampQuality(quality: number): number {
  return Math.min(100, Math.max(1, Number(quality) || 1))
}

/**
 * Map UI quality 1–100 → DPI + JPEG + grayscale.
 *
 * - q=1   → 72 dpi  / JPEG 0.32 / gray   (screen floor)
 * - q=50  → 111 dpi / JPEG 0.52 / color
 * - q=100 → 150 dpi / JPEG 0.72 / color  (ebook ceiling)
 *
 * Never targets print DPI — strong compress is for size, not archival.
 */
export function mapQualityToRaster(quality: number): StrongRasterParams {
  // Map slider 1..100 → t 0..1 so q=1 hits screen floor exactly.
  const t = (clampQuality(quality) - 1) / 99
  // Linear in t: GS presets are stepwise; slider wants smooth.
  const dpi = Math.round(72 + t * (150 - 72))
  // GS JPEGQ for recompress is often mid; keep aggressive-but-readable.
  const jpegQuality = 0.32 + t * 0.4
  // Below ~35: force gray like a more aggressive screen preset.
  const grayscale = clampQuality(quality) < 35
  return { dpi, jpegQuality, grayscale }
}

export interface PageSizePt {
  /** Media box width in PDF points (1/72"). */
  widthPt: number
  /** Media box height in PDF points. */
  heightPt: number
}

export interface RasterPixelSize {
  widthPx: number
  heightPx: number
  /** pdf.js viewport scale = dpi / 72 */
  scale: number
}

/**
 * Compute raster pixel size for a page given target DPI.
 * Page dimensions stay in points; pixels = points * (dpi/72).
 * Never upscales past the natural 72dpi CSS pixel size * (dpi/72) — that's the
 * definition of the DPI target (vector pages benefit; huge scans get downsampled
 * by pdf.js render at this scale relative to full detail only if source is vector;
 * for already-raster content pdf.js still paints at this pixel budget).
 */
export function computeRasterPixelSize(
  page: PageSizePt,
  dpi: number,
): RasterPixelSize {
  const d = Math.max(10, Math.min(300, Number(dpi) || 72))
  const scale = d / PDF_USER_UNIT_DPI
  const widthPx = Math.max(1, Math.round(page.widthPt * scale))
  const heightPx = Math.max(1, Math.round(page.heightPt * scale))
  return { widthPx, heightPx, scale }
}

/**
 * Hard ceiling on long edge so a huge page at 150dpi cannot OOM
 * (e.g. A0 poster). When hit, both axes scale down uniformly; page
 * point size is unchanged so the PDF still prints at correct paper size.
 */
export const STRONG_MAX_LONG_EDGE_PX = 2000

export function applyLongEdgeCap(
  size: RasterPixelSize,
  maxLongEdgePx: number = STRONG_MAX_LONG_EDGE_PX,
): RasterPixelSize {
  const long = Math.max(size.widthPx, size.heightPx)
  if (long <= maxLongEdgePx) return size
  const factor = maxLongEdgePx / long
  return {
    widthPx: Math.max(1, Math.round(size.widthPx * factor)),
    heightPx: Math.max(1, Math.round(size.heightPx * factor)),
    scale: size.scale * factor,
  }
}
