export type PdfThumbResult = {
  thumbUrl: string
  pageCount: number
}

async function loadPdf(source: File | ArrayBuffer | Uint8Array) {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs'

  let data: Uint8Array
  if (source instanceof File) {
    data = new Uint8Array(await source.arrayBuffer())
  } else if (source instanceof ArrayBuffer) {
    data = new Uint8Array(source)
  } else {
    data = source
  }

  return pdfjsLib.getDocument({ data, useSystemFonts: true }).promise
}

async function renderPageToDataUrl(
  page: { getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: any) => { promise: Promise<void> } },
  maxWidth: number,
  jpegQuality = 0.72,
): Promise<string> {
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(2, maxWidth / Math.max(base.width, 1))
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(viewport.width))
  canvas.height = Math.max(1, Math.floor(viewport.height))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D not available')
  await page.render({ canvasContext: ctx, viewport }).promise
  return canvas.toDataURL('image/jpeg', jpegQuality)
}

/**
 * Render page 1 of a PDF to a small JPEG data URL and return page count.
 * Uses pdfjs-dist (same stack as compress raster path).
 */
export async function renderPdfFirstPageThumb(
  source: File | ArrayBuffer | Uint8Array,
  options: { maxWidth?: number } = {},
): Promise<PdfThumbResult> {
  const maxWidth = options.maxWidth ?? 180
  const pdf = await loadPdf(source)
  const pageCount = pdf.numPages
  const page = await pdf.getPage(1)
  const thumbUrl = await renderPageToDataUrl(page, maxWidth)
  return { thumbUrl, pageCount }
}

/**
 * Render all pages (or a page range) to JPEG data URLs.
 * Yields progress via optional onPage callback.
 */
export async function renderPdfAllPageThumbs(
  source: File | ArrayBuffer | Uint8Array,
  options: {
    maxWidth?: number
    onPage?: (pageIndex1: number, thumbUrl: string, pageCount: number) => void
    signal?: { aborted?: boolean }
  } = {},
): Promise<{ pageCount: number; thumbs: string[] }> {
  const maxWidth = options.maxWidth ?? 160
  const pdf = await loadPdf(source)
  const pageCount = pdf.numPages
  const thumbs: string[] = new Array(pageCount)
  for (let i = 1; i <= pageCount; i++) {
    if (options.signal?.aborted) break
    const page = await pdf.getPage(i)
    const url = await renderPageToDataUrl(page, maxWidth, 0.7)
    thumbs[i - 1] = url
    options.onPage?.(i, url, pageCount)
  }
  return { pageCount, thumbs }
}
