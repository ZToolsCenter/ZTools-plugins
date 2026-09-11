const path = require('node:path')
const fs = require('node:fs')
const PptxGenJS = require('pptxgenjs')

function pageTitle(page) {
  if (page.title) return page.title
  const h = (page.blocks || []).find((b) => b.type === 'heading')
  return (h && h.text) || `第 ${page.page || ''} 页`
}

function pageBullets(page) {
  const lines = []
  for (const b of page.blocks || []) {
    if (b.type === 'heading') continue
    if (b.type === 'paragraph' && b.text) lines.push(b.text)
    if (b.type === 'bullet') for (const item of b.items || []) lines.push(item)
    if (b.type === 'table' && b.rows) {
      for (const row of b.rows) lines.push(row.join(' | '))
    }
  }
  return lines.length ? lines : ['（无内容）']
}

async function writePpt(doc, outputPath) {
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'LAYOUT_16x9', width: 13.333, height: 7.5 })
  pptx.layout = 'LAYOUT_16x9'
  const pages = doc.pages && doc.pages.length ? doc.pages : [{ blocks: [] }]
  for (const page of pages) {
    const slide = pptx.addSlide()
    slide.addText(pageTitle(page), {
      x: 0.5, y: 0.4, w: 12.3, h: 0.8,
      fontSize: 28, fontFace: 'Microsoft YaHei', bold: true, color: '1F2937',
    })
    slide.addText(pageBullets(page).map((t) => ({ text: t, options: { breakLine: true } })), {
      x: 0.5, y: 1.4, w: 12.3, h: 5.5,
      fontSize: 18, fontFace: 'Microsoft YaHei', color: '374151', valign: 'top',
    })
  }
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true })
  const buf = await pptx.write({ outputType: 'nodebuffer' })
  fs.writeFileSync(outputPath, buf)
  return outputPath
}

module.exports = { writePpt }
