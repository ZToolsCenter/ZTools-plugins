const fs = require('node:fs')
const path = require('node:path')
const { PDFDocument } = require('pdf-lib')
const {
  assertSafeOutputPath,
  assertSafeInputFile,
  safePathLabel,
} = require('./path-guard')
const pdfOperations = require('./lib/pdf-operations')
const { createPdfFromImages: buildPdfFromImages } = require('./lib/create-pdf-from-images')
const settingsStore = require('./lib/settings-store')
const { resolveTaskCoords } = require('./lib/task-paths')
const {
  hexToRgb01,
  rotatedTextBounds,
  positionToXY,
  tileSteps,
} = require('./lib/watermark-layout')

function getDownloadsRoot() {
  return window.ztools.getPath('downloads')
}

function getLogPath() {
  try {
    const base =
      (window.ztools &&
        window.ztools.getPath &&
        (window.ztools.getPath('userData') || window.ztools.getPath('downloads'))) ||
      null
    if (base) return path.join(base, 'pdf-process.log')
  } catch {}
  try {
    return path.join(require('node:os').tmpdir(), 'pdf-process.log')
  } catch {
    return path.join(process.cwd(), 'pdf-process.log')
  }
}

const LOG_PATH = getLogPath()

function log(level, msg, data) {
  const ts = new Date().toISOString()
  let payload = data
  if (typeof data === 'string' && (data.includes('\\') || data.includes('/'))) {
    payload = safePathLabel(data)
  }
  const line =
    '[' +
    ts +
    '] [' +
    level +
    '] ' +
    msg +
    (payload !== undefined ? ' ' + JSON.stringify(payload) : '') +
    '\n'
  try {
    console.log(line.trim())
  } catch {}
  try {
    fs.appendFileSync(LOG_PATH, line, { encoding: 'utf-8' })
  } catch {}
}

const { cancelCurrent } = pdfOperations

log('INFO', 'services.js loaded', { logfile: safePathLabel(LOG_PATH) })

function ensuredDir(dir) {
  if (!fs.existsSync(dir)) {
    log('INFO', 'mkdir', safePathLabel(dir))
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

function outputDir(feature) {
  const name = String(feature || 'out').replace(/[^a-zA-Z0-9_-]/g, '') || 'out'
  return ensuredDir(path.join(getDownloadsRoot(), 'pdf-' + name))
}

function safeOut(filePath, label) {
  return assertSafeOutputPath(filePath, getDownloadsRoot(), label)
}

function safeIn(filePath) {
  return assertSafeInputFile(filePath, fs)
}

function listFiles(dir, exts) {
  if (!fs.existsSync(dir)) {
    log('WARN', 'listFiles: dir not found', safePathLabel(dir))
    return []
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => exts.some((e) => f.toLowerCase().endsWith(e)))
    .map((f) => path.join(dir, f))
    .sort()
  log('INFO', 'listFiles', { dir: safePathLabel(dir), count: files.length })
  return files
}

function loadCjkFontBytes() {
  const winDir = process.env.WINDIR || 'C:\\Windows'
  const candidates = [
    path.join(winDir, 'Fonts', 'simhei.ttf'),
    path.join(winDir, 'Fonts', 'simfang.ttf'),
    path.join(winDir, 'Fonts', 'simkai.ttf'),
    path.join(winDir, 'Fonts', 'msyh.ttf'),
    path.join(winDir, 'Fonts', 'msyhbd.ttf'),
    path.join(winDir, 'Fonts', 'msyhl.ttf'),
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p)
    } catch {}
  }
  return null
}

async function addWatermarkWithPdfLib(inputPath, outputPath, opts) {
  const { rgb, degrees, StandardFonts } = require('pdf-lib')
  let fontkit
  try { fontkit = require('@pdf-lib/fontkit') } catch (e) {
    throw new Error('fontkit not available: ' + (e && e.message))
  }
  const bytes = fs.readFileSync(inputPath)
  // Respect PDF encryption; do not silently bypass passwords.
  const pdfDoc = await PDFDocument.load(bytes)
  pdfDoc.registerFontkit(fontkit)

  let font
  const fontBytes = loadCjkFontBytes()
  if (fontBytes) {
    font = await pdfDoc.embedFont(fontBytes, { subset: true })
  } else {
    const hasCjk = /[\u4e00-\u9fff]/.test(opts.text || '')
    if (hasCjk) throw new Error('No TTF CJK font available for pdf-lib watermark')
    font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  }

  const color = hexToRgb01(opts.color)
  const opacity = Math.min(1, Math.max(0.05, Number(opts.opacity) || 0.3))
  const fontSize = Math.max(8, Number(opts.points) || 20)
  const rotation = Number(opts.rotation) || 0
  const margin = Number(opts.margin) || 20
  const density = opts.density != null ? Number(opts.density) : 3
  const text = String(opts.text || 'Watermark')
  const textWidth = font.widthOfTextAtSize(text, fontSize)
  const textHeight = font.heightAtSize(fontSize)
  const rotBounds = rotatedTextBounds(textWidth, textHeight, rotation)

  for (const page of pdfDoc.getPages()) {
    const { width, height } = page.getSize()
    if (opts.tile) {
      const { stepX, stepY } = tileSteps(textWidth, textHeight, density)
      // start so first stamp's rotated box sits inside margin
      const startX = margin - rotBounds.minX
      const startY = margin - rotBounds.minY
      const endX = width - margin - rotBounds.maxX
      const endY = height - margin - rotBounds.maxY
      for (let y = startY; y <= endY + 0.5; y += stepY) {
        for (let x = startX; x <= endX + 0.5; x += stepX) {
          page.drawText(text, {
            x,
            y,
            size: fontSize,
            font,
            color: rgb(color.r, color.g, color.b),
            opacity,
            rotate: degrees(rotation),
          })
        }
      }
    } else {
      const xy = positionToXY(
        opts.position || 'mc',
        width,
        height,
        textWidth,
        textHeight,
        margin,
        rotation,
      )
      page.drawText(text, {
        x: xy.x,
        y: xy.y,
        size: fontSize,
        font,
        color: rgb(color.r, color.g, color.b),
        opacity,
        rotate: degrees(rotation),
      })
    }
  }

  const out = await pdfDoc.save({ useObjectStreams: true })
  fs.writeFileSync(outputPath, out)
  return outputPath
}
window.services = {
  cancelCurrent,

  deleteFile(filePath) {
    try {
      const resolved = safeOut(filePath, '删除路径')
      if (fs.existsSync(resolved)) {
        fs.unlinkSync(resolved)
        log('INFO', 'deleteFile', safePathLabel(resolved))
        return true
      }
    } catch (e) {
      log('WARN', 'deleteFile failed', e && e.message)
    }
    return false
  },

  writeImageFile(base64Url, outputPath) {
    const matchs = /^data:image\/([a-z]{1,20});base64,/i.exec(base64Url)
    if (!matchs) {
      log('WARN', 'writeImageFile: invalid base64')
      return
    }
    let filePath
    if (outputPath) {
      filePath = safeOut(outputPath, '图片输出路径')
      ensuredDir(path.dirname(filePath))
    } else {
      const dir = outputDir('images')
      filePath = path.join(dir, Date.now().toString() + '.' + matchs[1])
    }
    fs.writeFileSync(filePath, base64Url.substring(matchs[0].length), { encoding: 'base64' })
    log('INFO', 'writeImageFile', safePathLabel(filePath))
    return filePath
  },

  writeFileBase64(base64, outputPath) {
    if (typeof base64 !== 'string' || !base64.trim()) {
      throw new Error('文件数据无效')
    }
    const buf = Buffer.from(base64, 'base64')
    if (!buf.length) throw new Error('文件数据无效')
    const filePath = safeOut(outputPath, '临时输入路径')
    ensuredDir(path.dirname(filePath))
    fs.writeFileSync(filePath, buf)
    log('INFO', 'writeFileBase64', safePathLabel(filePath))
    return filePath
  },

  async createPdfFromImages(imagePaths, outputPath, options = {}) {
    const out = safeOut(outputPath, 'PDF 输出路径')
    log('INFO', 'createPdfFromImages', { count: imagePaths.length, out: safePathLabel(out) })
    ensuredDir(path.dirname(out))
    const safeImages = imagePaths.map((p) => safeOut(p, '图片输入路径'))
    await buildPdfFromImages(safeImages, out, options)
    return out
  },

  async compressPdf(inputPath, outputPath, options = {}) {
    const input = safeIn(inputPath)
    const out = safeOut(outputPath, '压缩输出路径')
    ensuredDir(path.dirname(out))
    const mode = 'optimize'
    log('INFO', 'compressPdf', {
      input: safePathLabel(input),
      output: safePathLabel(out),
      mode,
    })

    await pdfOperations.optimizePdf(input, out)
    log('INFO', 'compressPdf done via pdf-lib', safePathLabel(out))
    return out
  },

  async mergePdfs(inputPaths, outputPath) {
    const inputs = inputPaths.map((p) => safeIn(p))
    const out = safeOut(outputPath, '合并输出路径')
    ensuredDir(path.dirname(out))
    await pdfOperations.mergePdfs(inputs, out)
    return out
  },

  async splitPdf(inputPath, outputDirPath, options) {
    const input = safeIn(inputPath)
    const outDir = safeOut(outputDirPath, '拆分输出目录')
    ensuredDir(outDir)
    return pdfOperations.splitPdf(input, outDir, options)
  },

  async addWatermark(inputPath, outputPath, watermark) {
    const input = safeIn(inputPath)
    const out = safeOut(outputPath, '水印输出路径')
    ensuredDir(path.dirname(out))
    const text = (watermark && watermark.text) || 'Watermark'
    const opacity = watermark && watermark.opacity != null ? Number(watermark.opacity) : 0.3
    const points = watermark && watermark.points != null ? Number(watermark.points) : 36
    const rotation = watermark && watermark.rotation != null ? Number(watermark.rotation) : 0
    const margin = watermark && watermark.margin != null ? Number(watermark.margin) : 20
    const tile = !!(watermark && watermark.tile)
    const position = (watermark && watermark.position) || 'mc'
    const color = (watermark && watermark.color) || '#808080'
    const density = watermark && watermark.density != null ? Number(watermark.density) : 3

    await addWatermarkWithPdfLib(input, out, {
      text,
      opacity,
      points,
      rotation,
      margin,
      tile,
      position,
      color,
      density,
    })
    log('INFO', 'addWatermark done via pdf-lib', { output: safePathLabel(out) })
    return out
  },

  async convertPdf(inputPath, outputPath, format) {
    const input = safeIn(inputPath)
    const out = safeOut(outputPath, '转换输出路径')
    if (!['word', 'ppt', 'excel'].includes(format)) throw new Error('不支持的转换格式: ' + format)
    ensuredDir(path.dirname(out))
    let convertPdfLocal
    try {
      ;({ convertPdfLocal } = require('./convert/convert-local'))
    } catch (e) {
      if (e && e.code === 'MODULE_NOT_FOUND') {
        throw new Error('本地转换依赖未安装，请在 public/preload 执行 npm install')
      }
      throw e
    }
    return convertPdfLocal({ inputPath: input, outputPath: out, format })
  },

  async convertPdfImages(pages, outputPath, format) {
    if (!['word', 'ppt'].includes(format)) throw new Error('页面图像转换仅支持 Word 或 PPT')
    const out = safeOut(outputPath, '转换输出路径')
    ensuredDir(path.dirname(out))
    const safePages = (Array.isArray(pages) ? pages : []).map((page) => ({
      path: safeOut(page.path, '页面图像路径'),
      width: Number(page.width),
      height: Number(page.height),
    }))
    const { convertPdfImages } = require('./convert/convert-local')
    return convertPdfImages({ pages: safePages, outputPath: out, format })
  },

  resolveTaskPath(coords) {
    const r = resolveTaskCoords(getDownloadsRoot(), coords)
    if (r.filePath) {
      ensuredDir(path.dirname(r.filePath))
      return r.filePath
    }
    ensuredDir(r.dir)
    return r.dir
  },

  /** Stat a readable path for UI (size only). Inputs may be user-selected anywhere. */
  statFile(filePath) {
    try {
      if (!filePath || typeof filePath !== 'string') return null
      const resolved = path.resolve(filePath)
      const st = fs.statSync(resolved)
      if (!st.isFile()) return null
      return { size: st.size, mtimeMs: st.mtimeMs }
    } catch {
      return null
    }
  },

  /**
   * Read an existing user-selected file as base64 (for renderer-side strong compress
   * when only a path is available from the system open dialog).
   */
  readFileBase64(filePath) {
    const input = safeIn(filePath)
    const buf = fs.readFileSync(input)
    return buf.toString('base64')
  },

  /**
   * Page count for a PDF path (path-only files without browser File handle).
   * Uses pdf-lib (no canvas) so it works under asar without worker issues.
   */
  async getPdfPageCount(filePath) {
    try {
      const input = safeIn(filePath)
      const bytes = fs.readFileSync(input)
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
      return pdf.getPageCount()
    } catch (e) {
      log('WARN', 'getPdfPageCount failed', e && e.message)
      return 0
    }
  },

  async getSettings() {
    return settingsStore.loadSettings(window.ztools.dbStorage)
  },

  async saveSettings(settings) {
    settingsStore.saveSettings(window.ztools.dbStorage, settings)
  },
}
