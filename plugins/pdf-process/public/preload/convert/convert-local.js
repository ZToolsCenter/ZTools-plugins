/**
 * Local PDF → Office conversion (no convert.exe).
 * - Enough text: heuristic DocumentSchema → docx/xlsx/pptx writers
 * - Sparse text (scan): renderer supplies page PNGs for Word/PPT; Excel keeps residual text
 */
const fs = require('node:fs')
const path = require('node:path')
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun,
} = require('docx')
const { normalizeDocument } = require('./schema')
const { extractPdfText: defaultExtract } = require('./extract-pdf-text')
const { writeWord: defaultWriteWord } = require('./write-word')
const { writeExcel: defaultWriteExcel } = require('./write-excel')
const { writePpt: defaultWritePpt } = require('./write-ppt')

const MIN_TOTAL_CHARS = 20

/**
 * Build a simple DocumentSchema from extracted plain text.
 * @param {{ pages: Array<{ page: number, text: string }>, totalChars: number }} extracted
 */
function textToDocument(extracted) {
  const pages = (extracted.pages || []).map((p) => {
    const lines = String(p.text || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    const blocks = []
    for (const line of lines) {
      // crude heading: short line without ending punctuation
      if (line.length <= 40 && !/[.。;；:：!！?？]$/.test(line) && lines.length > 1) {
        blocks.push({ type: 'heading', level: 2, text: line })
      } else {
        blocks.push({ type: 'paragraph', text: line })
      }
    }
    if (!blocks.length) {
      blocks.push({ type: 'paragraph', text: '' })
    }
    return { page: p.page, blocks }
  })
  return normalizeDocument({ pages: pages.length ? pages : [{ page: 1, blocks: [{ type: 'paragraph', text: '' }] }] })
}

/**
 * Excel-oriented doc: one sheet per page, one line per row.
 */
function textToExcelDocument(extracted) {
  const sheets = (extracted.pages || []).map((p) => {
    const lines = String(p.text || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    const rows = lines.length ? lines.map((l) => [l]) : [['']]
    return { name: ('Page ' + p.page).slice(0, 31), rows }
  })
  if (!sheets.length) sheets.push({ name: 'Sheet1', rows: [['']] })
  return normalizeDocument({
    pages: [{ page: 1, blocks: [{ type: 'paragraph', text: '' }] }],
    sheets,
  })
}

/**
 * PPT: title + bullets from lines (text mode).
 */
function textToPptDocument(extracted) {
  const pages = (extracted.pages || []).map((p) => {
    const lines = String(p.text || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    const title = lines[0] || ('第 ' + p.page + ' 页')
    const rest = lines.slice(1)
    const blocks = []
    if (rest.length) {
      blocks.push({ type: 'bullet', items: rest })
    } else if (lines[0]) {
      blocks.push({ type: 'paragraph', text: lines[0] })
    } else {
      blocks.push({ type: 'paragraph', text: '（无文本）' })
    }
    return { page: p.page, title, blocks }
  })
  return normalizeDocument({ pages })
}

/**
 * Write DOCX with one full-page image per PDF page (local scan fallback).
 * @param {Array<{ page: number, png: Buffer, width: number, height: number }>} rendered
 * @param {string} outputPath
 */
async function writeWordFromPageImages(rendered, outputPath) {
  const children = []
  for (let i = 0; i < rendered.length; i++) {
    const page = rendered[i]
    // docx ImageRun expects width/height in pixels (display); cap width ~600px
    const maxW = 600
    const scale = page.width > maxW ? maxW / page.width : 1
    const w = Math.max(1, Math.round(page.width * scale))
    const h = Math.max(1, Math.round(page.height * scale))
    children.push(
      new Paragraph({
        children: [
          new ImageRun({
            type: 'png',
            data: page.png,
            transformation: { width: w, height: h },
            altText: { title: 'Page ' + page.page, description: 'PDF page ' + page.page, name: 'page-' + page.page },
          }),
        ],
      }),
    )
    if (i < rendered.length - 1) {
      children.push(new Paragraph({ children: [] }))
    }
  }
  if (!children.length) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: '（无页面）', font: 'Microsoft YaHei' })],
      }),
    )
  }
  const document = new Document({
    sections: [{ properties: {}, children }],
  })
  const buf = await Packer.toBuffer(document)
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true })
  fs.writeFileSync(outputPath, buf)
  return outputPath
}

/**
 * Write PPTX with one image slide per page.
 */
async function writePptFromPageImages(rendered, outputPath) {
  const PptxGenJS = require('pptxgenjs')
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'LAYOUT_16x9', width: 13.333, height: 7.5 })
  pptx.layout = 'LAYOUT_16x9'
  for (const page of rendered) {
    const slide = pptx.addSlide()
    const dataUrl = 'image/png;base64,' + page.png.toString('base64')
    // fit image in slide
    slide.addImage({
      data: dataUrl,
      x: 0,
      y: 0,
      w: '100%',
      h: '100%',
    })
  }
  if (!rendered.length) {
    const slide = pptx.addSlide()
    slide.addText('（无页面）', {
      x: 0.5, y: 3, w: 12, h: 1,
      fontFace: 'Microsoft YaHei', fontSize: 18,
    })
  }
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true })
  const buf = await pptx.write({ outputType: 'nodebuffer' })
  fs.writeFileSync(outputPath, buf)
  return outputPath
}

async function convertPdfLocal(opts) {
  const format = opts.format
  if (!['word', 'ppt', 'excel'].includes(format)) {
    throw new Error('不支持的转换格式: ' + format)
  }
  const extractPdfText = opts.extractPdfText || defaultExtract
  const writeWord = opts.writeWord || defaultWriteWord
  const writeExcel = opts.writeExcel || defaultWriteExcel
  const writePpt = opts.writePpt || defaultWritePpt

  const extracted = await extractPdfText(opts.inputPath)
  const hasText = extracted.pages.length && extracted.totalChars >= MIN_TOTAL_CHARS

  if (hasText) {
    if (format === 'word') {
      return writeWord(textToDocument(extracted), opts.outputPath)
    }
    if (format === 'excel') {
      return writeExcel(textToExcelDocument(extracted), opts.outputPath)
    }
    return writePpt(textToPptDocument(extracted), opts.outputPath)
  }

  if (format === 'word' || format === 'ppt') {
    const error = new Error('该 PDF 缺少可提取文本，需要在渲染器生成页面图像')
    error.code = 'SCAN_RENDER_REQUIRED'
    throw error
  }

  // Excel: residual text + notice rows
  const notice = [
    ['说明'],
    ['该 PDF 文本层不足（可能为扫描件），本地无法可靠提取表格。'],
    ['已抽取到的文本如下：'],
    [''],
  ]
  const textRows = []
  for (const p of extracted.pages || []) {
    textRows.push(['--- 第 ' + p.page + ' 页 ---'])
    const lines = String(p.text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (lines.length) {
      for (const l of lines) textRows.push([l])
    } else {
      textRows.push(['（无文本）'])
    }
  }
  const doc = normalizeDocument({
    pages: [{ page: 1, blocks: [{ type: 'paragraph', text: '' }] }],
    sheets: [{ name: 'Extracted', rows: notice.concat(textRows) }],
  })
  return writeExcel(doc, opts.outputPath)
}

async function convertPdfImages(opts) {
  if (!['word', 'ppt'].includes(opts.format)) {
    throw new Error('页面图像转换仅支持 Word 或 PPT')
  }
  const rendered = (opts.pages || []).map((page, index) => ({
    page: index + 1,
    png: fs.readFileSync(page.path),
    width: Math.max(1, Number(page.width) || 1),
    height: Math.max(1, Number(page.height) || 1),
  }))
  if (!rendered.length) throw new Error('未收到任何 PDF 页面图像')
  return opts.format === 'word'
    ? writeWordFromPageImages(rendered, opts.outputPath)
    : writePptFromPageImages(rendered, opts.outputPath)
}

module.exports = {
  convertPdfLocal,
  convertPdfImages,
  textToDocument,
  textToExcelDocument,
  textToPptDocument,
  writeWordFromPageImages,
  writePptFromPageImages,
  MIN_TOTAL_CHARS,
}
