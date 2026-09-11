const path = require('node:path')
const fs = require('node:fs')
const ExcelJS = require('exceljs')

function tablesFromPages(doc) {
  const tables = []
  for (const page of doc.pages || []) {
    for (const b of page.blocks || []) {
      if (b.type === 'table' && b.rows && b.rows.length) tables.push(b.rows)
    }
  }
  return tables
}

function textRowsFromPages(doc) {
  const rows = []
  for (const page of doc.pages || []) {
    for (const b of page.blocks || []) {
      if (b.type === 'paragraph' || b.type === 'heading') rows.push([b.text])
      if (b.type === 'bullet') for (const item of b.items || []) rows.push([item])
    }
  }
  return rows.length ? rows : [['']]
}

async function writeExcel(doc, outputPath) {
  const wb = new ExcelJS.Workbook()
  if (doc.sheets && doc.sheets.length) {
    for (const sheet of doc.sheets) {
      const ws = wb.addWorksheet(sheet.name || 'Sheet1')
      for (const row of sheet.rows || []) ws.addRow(row)
      ws.getRow(1).font = { bold: true, name: 'Microsoft YaHei' }
    }
  } else {
    const tables = tablesFromPages(doc)
    if (tables.length) {
      tables.forEach((rows, i) => {
        const ws = wb.addWorksheet(`Table ${i + 1}`.slice(0, 31))
        for (const row of rows) ws.addRow(row)
        ws.getRow(1).font = { bold: true, name: 'Microsoft YaHei' }
      })
    } else {
      const ws = wb.addWorksheet('Content')
      for (const row of textRowsFromPages(doc)) ws.addRow(row)
    }
  }
  if (!wb.worksheets.length) wb.addWorksheet('Sheet1')
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true })
  await wb.xlsx.writeFile(outputPath)
  return outputPath
}

module.exports = { writeExcel }
