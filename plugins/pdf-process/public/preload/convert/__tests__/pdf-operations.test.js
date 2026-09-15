import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { PDFDocument } from 'pdf-lib'

const require = createRequire(import.meta.url)
const operations = require('../../lib/pdf-operations.js')

let tempDir

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-operations-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

async function createPdf(name, pageCount) {
  const pdf = await PDFDocument.create()
  for (let page = 1; page <= pageCount; page += 1) {
    const outputPage = pdf.addPage([300, 400])
    outputPage.drawText(`page ${page}`)
  }
  const filePath = path.join(tempDir, name)
  fs.writeFileSync(filePath, await pdf.save({ useObjectStreams: false }))
  return filePath
}

async function pageCount(filePath) {
  const pdf = await PDFDocument.load(fs.readFileSync(filePath))
  return pdf.getPageCount()
}

describe('pdf-operations', () => {
  it('optimizes without making the file larger', async () => {
    const input = await createPdf('input.pdf', 3)
    const output = path.join(tempDir, 'optimized.pdf')

    await operations.optimizePdf(input, output)

    expect(await pageCount(output)).toBe(3)
    expect(fs.statSync(output).size).toBeLessThanOrEqual(fs.statSync(input).size)
  })

  it('merges every source page in order', async () => {
    const first = await createPdf('first.pdf', 2)
    const second = await createPdf('second.pdf', 3)
    const output = path.join(tempDir, 'merged.pdf')

    await operations.mergePdfs([first, second], output)

    expect(await pageCount(output)).toBe(5)
  })

  it('splits by span and explicit boundaries', async () => {
    const input = await createPdf('source.pdf', 5)
    const spanDir = path.join(tempDir, 'span')
    const boundaryDir = path.join(tempDir, 'boundary')
    fs.mkdirSync(spanDir)
    fs.mkdirSync(boundaryDir)

    const spanOutputs = await operations.splitPdf(input, spanDir, { span: 2 })
    const boundaryOutputs = await operations.splitPdf(input, boundaryDir, { beforePages: [3, 5] })

    expect(await Promise.all(spanOutputs.map(pageCount))).toEqual([2, 2, 1])
    expect(await Promise.all(boundaryOutputs.map(pageCount))).toEqual([2, 2, 1])
  })

  it('extracts ranges into one or multiple files', async () => {
    const input = await createPdf('source.pdf', 6)
    const mergedDir = path.join(tempDir, 'merged-ranges')
    const separateDir = path.join(tempDir, 'separate-ranges')
    fs.mkdirSync(mergedDir)
    fs.mkdirSync(separateDir)

    const merged = await operations.splitPdf(input, mergedDir, {
      pageRanges: [[1, 2], [5, 6]],
      mergeRanges: true,
    })
    const separate = await operations.splitPdf(input, separateDir, {
      pageRanges: [[1, 2], [5, 6]],
      mergeRanges: false,
    })

    expect(merged).toHaveLength(1)
    expect(await pageCount(merged[0])).toBe(4)
    expect(await Promise.all(separate.map(pageCount))).toEqual([2, 2])
  })

  it('extracts a string page specification as individual pages', async () => {
    const input = await createPdf('source.pdf', 5)
    const outputDir = path.join(tempDir, 'pages')
    fs.mkdirSync(outputDir)

    const outputs = await operations.splitPdf(input, outputDir, '1,3-4')

    expect(outputs).toHaveLength(3)
    expect(await Promise.all(outputs.map(pageCount))).toEqual([1, 1, 1])
  })
})
