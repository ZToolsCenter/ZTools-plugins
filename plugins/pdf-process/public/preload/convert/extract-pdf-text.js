const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL, fileURLToPath } = require('node:url')

let pdfjsPromise

/**
 * Root of the installed pdfjs-dist package.
 * @returns {string}
 */
function resolvePdfjsPackageDir() {
  return path.dirname(require.resolve('pdfjs-dist/package.json'))
}

/**
 * Resolve pdf.worker path (works with normal node_modules and asar layouts).
 * @returns {string}
 */
function resolveWorkerPath() {
  try {
    return require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
  } catch {
    return path.join(resolvePdfjsPackageDir(), 'legacy', 'build', 'pdf.worker.mjs')
  }
}

/**
 * Absolute dirs for CID cmaps and standard fonts (trailing sep for URL join).
 * @returns {{ cMapDir: string, standardFontDir: string }}
 */
function resolvePdfjsAssetDirs() {
  const pkg = resolvePdfjsPackageDir()
  const cMapDir = path.join(pkg, 'cmaps') + path.sep
  const standardFontDir = path.join(pkg, 'standard_fonts') + path.sep
  if (!fs.existsSync(path.join(pkg, 'cmaps'))) {
    throw new Error('pdfjs cmaps 目录不存在: ' + path.join(pkg, 'cmaps'))
  }
  return { cMapDir, standardFontDir }
}

/**
 * Convert a pdfjs asset URL (file path or file://) to a local filesystem path.
 * @param {string} url
 */
function toFsPath(url) {
  if (typeof url !== 'string') return String(url)
  if (url.startsWith('file:')) {
    try {
      return fileURLToPath(url)
    } catch {
      return url
    }
  }
  return url
}

/**
 * Electron preload is NOT detected as Node by pdfjs (window/Worker exist),
 * so DefaultCMapReaderFactory is DOM/fetch — file:// binary .bcmap fails.
 * Use fs-backed factories instead (same contract as pdfjs NodeCMapReaderFactory).
 */
class FsCMapReaderFactory {
  constructor({ baseUrl = null, isCompressed = true } = {}) {
    this.baseUrl = baseUrl
    this.isCompressed = isCompressed
  }

  async fetch({ name }) {
    if (!this.baseUrl) {
      throw new Error('Ensure that the `cMapUrl` and `cMapPacked` API parameters are provided.')
    }
    if (!name) {
      throw new Error('CMap name must be specified.')
    }
    const url = this.baseUrl + name + (this.isCompressed ? '.bcmap' : '')
    const filePath = toFsPath(url)
    try {
      const buf = await fs.promises.readFile(filePath)
      return { cMapData: new Uint8Array(buf), isCompressed: this.isCompressed }
    } catch {
      throw new Error(
        `Unable to load ${this.isCompressed ? 'binary ' : ''}CMap at: ${url}`,
      )
    }
  }
}

class FsStandardFontDataFactory {
  constructor({ baseUrl = null } = {}) {
    this.baseUrl = baseUrl
  }

  async fetch({ filename }) {
    if (!this.baseUrl) {
      throw new Error('Ensure that the `standardFontDataUrl` API parameter is provided.')
    }
    if (!filename) {
      throw new Error('Font filename must be specified.')
    }
    const url = `${this.baseUrl}${filename}`
    const filePath = toFsPath(url)
    try {
      const buf = await fs.promises.readFile(filePath)
      return new Uint8Array(buf)
    } catch {
      throw new Error(`Unable to load font data at: ${url}`)
    }
  }
}

/**
 * Configure GlobalWorkerOptions.workerSrc for Electron preload (has Worker)
 * and plain Node (may use fake worker).
 * @param {typeof import('pdfjs-dist/legacy/build/pdf.mjs')} pdfjs
 */
function configureWorker(pdfjs) {
  const workerPath = resolveWorkerPath()
  if (!fs.existsSync(workerPath)) {
    throw new Error('pdfjs worker 文件不存在: ' + workerPath)
  }

  const inAsar = workerPath.includes('.asar') || __dirname.includes('.asar')
  const canBlob =
    typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'

  if (canBlob && (inAsar || typeof Worker !== 'undefined')) {
    const code = fs.readFileSync(workerPath)
    const blob = new Blob([code], { type: 'text/javascript' })
    pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob)
    return
  }

  try {
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
  } catch {
    pdfjs.GlobalWorkerOptions.workerSrc = workerPath
  }
}

/**
 * Load pdfjs-dist legacy build (ESM) via dynamic import for CJS preload.
 * @returns {Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')>}
 */
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
      configureWorker(pdfjs)
      return pdfjs
    })
  }
  return pdfjsPromise
}

/**
 * Build getDocument options for text extraction (CID/CJK needs cMap + fs factory).
 * @param {Uint8Array} data
 */
function buildGetDocumentParams(data) {
  const { cMapDir, standardFontDir } = resolvePdfjsAssetDirs()
  const hasStandard = fs.existsSync(path.join(standardFontDir, '..', 'standard_fonts')) ||
    fs.existsSync(standardFontDir)

  const params = {
    data,
    // Filesystem paths (not file://) — used by FsCMapReaderFactory
    cMapUrl: cMapDir,
    cMapPacked: true,
    CMapReaderFactory: FsCMapReaderFactory,
    useSystemFonts: false,
    isEvalSupported: false,
    // Force main-thread factories (required so our Fs* factories are used)
    useWorkerFetch: false,
    disableFontFace: true,
    isOffscreenCanvasSupported: false,
  }

  if (hasStandard) {
    params.standardFontDataUrl = standardFontDir
    params.StandardFontDataFactory = FsStandardFontDataFactory
  }

  return params
}

/**
 * Join pdfjs text items. Avoid inserting spaces between pure CJK runs.
 * @param {Array<{ str?: string, hasEOL?: boolean }>} items
 */
function joinTextItems(items) {
  let out = ''
  for (const it of items) {
    const s = it && typeof it.str === 'string' ? it.str : ''
    if (!s) {
      if (it && it.hasEOL) out += '\n'
      continue
    }
    if (!out) {
      out = s
    } else if (it.hasEOL) {
      out += '\n' + s
    } else {
      const prev = out[out.length - 1]
      const next = s[0]
      const prevIsAsciiWord = /[A-Za-z0-9]/.test(prev)
      const nextIsAsciiWord = /[A-Za-z0-9]/.test(next)
      out += prevIsAsciiWord && nextIsAsciiWord ? ' ' + s : s
    }
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Extract per-page text from raw PDF bytes.
 * @param {Uint8Array} data
 * @returns {Promise<{ pages: Array<{ page: number, text: string }>, totalChars: number }>}
 */
async function extractPdfTextFromData(data) {
  const pdfjs = await loadPdfjs()
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    configureWorker(pdfjs)
  }
  const loadingTask = pdfjs.getDocument(buildGetDocumentParams(data))
  const pdf = await loadingTask.promise
  try {
    const pages = []
    let totalChars = 0
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent({
        includeMarkedContent: false,
        disableNormalization: false,
      })
      const text = joinTextItems(content.items)
      totalChars += text.length
      pages.push({ page: i, text })
    }
    return { pages, totalChars }
  } finally {
    try {
      await pdf.destroy()
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * Extract per-page text from a PDF file path.
 * @param {string} inputPath
 * @returns {Promise<{ pages: Array<{ page: number, text: string }>, totalChars: number }>}
 */
async function extractPdfText(inputPath) {
  if (!fs.existsSync(inputPath)) {
    throw new Error('输入文件不存在: ' + inputPath)
  }
  const buf = fs.readFileSync(inputPath)
  return extractPdfTextFromData(new Uint8Array(buf))
}

module.exports = {
  extractPdfText,
  extractPdfTextFromData,
  loadPdfjs,
  resolveWorkerPath,
  resolvePdfjsAssetDirs,
  configureWorker,
  buildGetDocumentParams,
  joinTextItems,
  FsCMapReaderFactory,
  FsStandardFontDataFactory,
}
