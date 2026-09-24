const fs = require('node:fs')
const path = require('node:path')
const { PDFDocument } = require('pdf-lib')

let cancellationVersion = 0

function cancelCurrent() {
  cancellationVersion += 1
}

function cancellationGuard() {
  const version = cancellationVersion
  return () => {
    if (version !== cancellationVersion) {
      const error = new Error('操作已取消')
      error.code = 'OPERATION_CANCELLED'
      throw error
    }
  }
}

async function loadPdf(inputPath) {
  return PDFDocument.load(fs.readFileSync(inputPath), { updateMetadata: false })
}

async function savePdf(pdfDoc, outputPath) {
  const bytes = await pdfDoc.save({
    useObjectStreams: true,
    addDefaultPage: false,
    objectsPerTick: 40,
    updateFieldAppearances: false,
  })
  fs.writeFileSync(outputPath, bytes)
  return outputPath
}

async function optimizePdf(inputPath, outputPath) {
  const checkCancelled = cancellationGuard()
  const source = fs.readFileSync(inputPath)
  const pdfDoc = await PDFDocument.load(source, { updateMetadata: false })
  checkCancelled()
  const optimized = await pdfDoc.save({
    useObjectStreams: true,
    addDefaultPage: false,
    objectsPerTick: 40,
    updateFieldAppearances: false,
  })
  checkCancelled()
  fs.writeFileSync(outputPath, optimized.length < source.length ? optimized : source)
  return outputPath
}

async function mergePdfs(inputPaths, outputPath) {
  if (!inputPaths.length) throw new Error('至少需要一个 PDF 文件')
  const checkCancelled = cancellationGuard()
  const merged = await PDFDocument.create()
  for (const inputPath of inputPaths) {
    checkCancelled()
    const source = await loadPdf(inputPath)
    const pages = await merged.copyPages(source, source.getPageIndices())
    for (const page of pages) merged.addPage(page)
  }
  checkCancelled()
  return savePdf(merged, outputPath)
}

function parsePageSpec(spec, pageCount) {
  const pages = []
  for (const token of String(spec).split(',')) {
    const value = token.trim()
    if (!value) continue
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(value)
    if (!match) throw new Error('页码范围格式无效: ' + value)
    const start = Number(match[1])
    const end = match[2] ? Number(match[2]) : start
    if (start < 1 || end < start || end > pageCount) {
      throw new Error('页码超出范围: ' + value)
    }
    for (let page = start; page <= end; page += 1) pages.push(page)
  }
  return Array.from(new Set(pages))
}

function normalizeRanges(ranges, pageCount) {
  return ranges.map((pair) => {
    const start = Math.floor(Number(pair[0]))
    const end = Math.floor(Number(pair[1]))
    if (start < 1 || end < start || end > pageCount) {
      throw new Error(`页码超出范围: ${start}-${end}`)
    }
    return [start, end]
  })
}

function rangesFromBeforePages(beforePages, pageCount) {
  const boundaries = Array.from(new Set(beforePages.map((page) => Math.floor(Number(page)))))
    .filter((page) => page >= 2 && page <= pageCount)
    .sort((a, b) => a - b)
  const ranges = []
  let start = 1
  for (const boundary of boundaries) {
    ranges.push([start, boundary - 1])
    start = boundary
  }
  ranges.push([start, pageCount])
  return ranges
}

function rangesFromSpan(span, pageCount) {
  const size = Math.max(1, Math.floor(Number(span) || 1))
  const ranges = []
  for (let start = 1; start <= pageCount; start += size) {
    ranges.push([start, Math.min(pageCount, start + size - 1)])
  }
  return ranges
}

async function writePageSelection(source, pageNumbers, outputPath, checkCancelled) {
  checkCancelled()
  const output = await PDFDocument.create()
  const indices = pageNumbers.map((page) => page - 1)
  const pages = await output.copyPages(source, indices)
  for (const page of pages) output.addPage(page)
  checkCancelled()
  return savePdf(output, outputPath)
}

async function splitPdf(inputPath, outputDir, options) {
  const checkCancelled = cancellationGuard()
  const source = await loadPdf(inputPath)
  const pageCount = source.getPageCount()
  const base = path.basename(inputPath, path.extname(inputPath)) || 'split'

  if (typeof options === 'string' && options.trim()) {
    const pages = parsePageSpec(options, pageCount)
    const outputs = []
    for (const page of pages) {
      const outputPath = path.join(outputDir, `${base}_${page}.pdf`)
      await writePageSelection(source, [page], outputPath, checkCancelled)
      outputs.push(outputPath)
    }
    return outputs
  }

  const opts = options && typeof options === 'object' ? options : {}
  if (Array.isArray(opts.pageRanges) && opts.pageRanges.length) {
    const ranges = normalizeRanges(opts.pageRanges, pageCount)
    if (opts.mergeRanges !== false) {
      const pages = ranges.flatMap(([start, end]) =>
        Array.from({ length: end - start + 1 }, (_, index) => start + index),
      )
      const label = ranges.length === 1
        ? ranges[0][0] === ranges[0][1] ? String(ranges[0][0]) : `${ranges[0][0]}-${ranges[0][1]}`
        : 'extract'
      const outputPath = path.join(outputDir, `${base}_${label}.pdf`)
      await writePageSelection(source, pages, outputPath, checkCancelled)
      return [outputPath]
    }
    return writeRanges(source, base, outputDir, ranges, checkCancelled)
  }

  const ranges = Array.isArray(opts.beforePages) && opts.beforePages.length
    ? rangesFromBeforePages(opts.beforePages, pageCount)
    : rangesFromSpan(opts.span, pageCount)
  return writeRanges(source, base, outputDir, ranges, checkCancelled)
}

async function writeRanges(source, base, outputDir, ranges, checkCancelled) {
  const outputs = []
  for (const [start, end] of ranges) {
    const label = start === end ? String(start) : `${start}-${end}`
    const outputPath = path.join(outputDir, `${base}_${label}.pdf`)
    const pages = Array.from({ length: end - start + 1 }, (_, index) => start + index)
    await writePageSelection(source, pages, outputPath, checkCancelled)
    outputs.push(outputPath)
  }
  return outputs
}

module.exports = {
  cancelCurrent,
  mergePdfs,
  optimizePdf,
  parsePageSpec,
  rangesFromBeforePages,
  rangesFromSpan,
  splitPdf,
}
