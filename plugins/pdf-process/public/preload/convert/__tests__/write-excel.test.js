// globals: true in vitest.preload.config.js — do not require('vitest') (Vitest 4 CJS ban)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ExcelJS = require('exceljs')
const sample = require('../fixtures/sample-schema.json')
const { writeExcel } = require('../write-excel.js')

describe('writeExcel', () => {
  it('writes xlsx with expected sheet data', async () => {
    const out = path.join(os.tmpdir(), `convert-xlsx-${Date.now()}.xlsx`)
    await writeExcel(sample, out)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(out)
    expect(wb.worksheets.length).toBeGreaterThan(0)
    const ws = wb.worksheets[0]
    expect(ws.getRow(1).getCell(1).value).toBe('姓名')
    fs.unlinkSync(out)
  })
})
