const fs = require('node:fs')
const path = require('node:path')
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, BorderStyle,
} = require('docx')

const HEADING = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
}

function blockToParagraphs(block) {
  if (block.type === 'heading') {
    return [new Paragraph({
      heading: HEADING[block.level] || HeadingLevel.HEADING_1,
      children: [new TextRun({ text: block.text, font: 'Microsoft YaHei' })],
    })]
  }
  if (block.type === 'paragraph') {
    return [new Paragraph({
      children: [new TextRun({ text: block.text, font: 'Microsoft YaHei' })],
    })]
  }
  if (block.type === 'bullet') {
    return (block.items || []).map((item) => new Paragraph({
      bullet: { level: 0 },
      children: [new TextRun({ text: item, font: 'Microsoft YaHei' })],
    }))
  }
  if (block.type === 'table') {
    const rows = (block.rows || []).map((row) => new TableRow({
      children: row.map((cell) => new TableCell({
        children: [new Paragraph({
          children: [new TextRun({ text: cell, font: 'Microsoft YaHei' })],
        })],
      })),
    }))
    if (!rows.length) return []
    return [new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows,
    })]
  }
  return []
}

async function writeWord(doc, outputPath) {
  const children = []
  if (doc.title) {
    children.push(new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: doc.title, font: 'Microsoft YaHei' })],
    }))
  }
  for (const page of doc.pages || []) {
    if (page.title) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: page.title, font: 'Microsoft YaHei' })],
      }))
    }
    for (const block of page.blocks || []) {
      children.push(...blockToParagraphs(block))
    }
  }
  if (!children.length) {
    children.push(new Paragraph({ children: [new TextRun({ text: '', font: 'Microsoft YaHei' })] }))
  }
  const document = new Document({
    sections: [{ properties: {}, children }],
  })
  const buf = await Packer.toBuffer(document)
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true })
  fs.writeFileSync(outputPath, buf)
  return outputPath
}

module.exports = { writeWord }
