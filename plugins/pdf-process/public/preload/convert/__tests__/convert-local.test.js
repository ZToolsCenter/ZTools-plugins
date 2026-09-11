// globals: true
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  convertPdfLocal,
  convertPdfImages,
  textToDocument,
  textToExcelDocument,
} = require('../convert-local.js')

const fixturePath = path.join(__dirname, '..', 'fixtures', 'sample-text.pdf')

describe('convertPdfLocal', () => {
  it('builds text document from extracted lines', () => {
    const doc = textToDocument({
      totalChars: 20,
      pages: [{ page: 1, text: 'Title Line\nBody paragraph here.' }],
    })
    expect(doc.pages[0].blocks.length).toBeGreaterThanOrEqual(1)
  })

  it('builds excel sheets per page', () => {
    const doc = textToExcelDocument({
      totalChars: 10,
      pages: [{ page: 1, text: 'a\nb' }],
    })
    expect(doc.sheets[0].rows).toEqual([['a'], ['b']])
  })

  it('converts text PDF to word without local', async () => {
    const out = path.join(os.tmpdir(), 'local-t-' + Date.now() + '.docx')
    await convertPdfLocal({
      inputPath: fixturePath,
      outputPath: out,
      format: 'word',
    })
    const buf = fs.readFileSync(out)
    expect(buf[0]).toBe(0x50)
    expect(buf[1]).toBe(0x4b)
    fs.unlinkSync(out)
  }, 30000)

  it('requests renderer images when text is sparse', async () => {
    await expect(
      convertPdfLocal({
        inputPath: 'in.pdf',
        outputPath: 'out.docx',
        format: 'word',
        extractPdfText: async () => ({ totalChars: 2, pages: [{ page: 1, text: 'ab' }] }),
      }),
    ).rejects.toMatchObject({ code: 'SCAN_RENDER_REQUIRED' })
  })

  it('writes page images supplied by the renderer', async () => {
    const out = path.join(os.tmpdir(), 'local-img-' + Date.now() + '.docx')
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )
    const pagePath = path.join(os.tmpdir(), 'scan-' + Date.now() + '.png')
    fs.writeFileSync(pagePath, png)
    await convertPdfImages({
      pages: [{ path: pagePath, width: 100, height: 100 }],
      outputPath: out,
      format: 'word',
    })
    const buf = fs.readFileSync(out)
    expect(buf[0]).toBe(0x50)
    expect(buf[1]).toBe(0x4b)
    fs.unlinkSync(out)
    fs.unlinkSync(pagePath)
  })
})
