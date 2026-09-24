// globals: true in vitest.preload.config.js — do not require('vitest') (Vitest 4 CJS ban)
const fs = require('node:fs')
const path = require('node:path')
const {
  extractPdfText,
  extractPdfTextFromData,
  loadPdfjs,
  resolveWorkerPath,
} = require('../extract-pdf-text.js')

const fixturePath = path.join(__dirname, '..', 'fixtures', 'sample-text.pdf')

describe('extractPdfText', () => {
  it('throws when file missing', async () => {
    await expect(extractPdfText(path.join(__dirname, 'no-such.pdf'))).rejects.toThrow(
      /不存在/,
    )
  })

  it('sets GlobalWorkerOptions.workerSrc before getDocument', async () => {
    const workerPath = resolveWorkerPath()
    expect(fs.existsSync(workerPath)).toBe(true)
    const pdfjs = await loadPdfjs()
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBeTruthy()
    expect(String(pdfjs.GlobalWorkerOptions.workerSrc).length).toBeGreaterThan(0)
  })

  it('extracts per-page text from fixture PDF', async () => {
    expect(fs.existsSync(fixturePath)).toBe(true)
    const result = await extractPdfText(fixturePath)
    expect(result.pages.length).toBeGreaterThan(0)
    expect(result.totalChars).toBeGreaterThan(0)
    expect(result.pages[0]).toMatchObject({ page: 1 })
    expect(typeof result.pages[0].text).toBe('string')
    // fixture is generated with "Hello PDF extract" on page 1
    expect(result.pages[0].text).toMatch(/Hello/i)
    expect(result.totalChars).toBe(
      result.pages.reduce((sum, p) => sum + p.text.length, 0),
    )
  })
})

describe('extractPdfTextFromData', () => {
  it('parses Uint8Array without reading disk path', async () => {
    const data = new Uint8Array(fs.readFileSync(fixturePath))
    const result = await extractPdfTextFromData(data)
    expect(result.pages.length).toBeGreaterThanOrEqual(1)
    expect(result.totalChars).toBeGreaterThan(0)
  })
})

