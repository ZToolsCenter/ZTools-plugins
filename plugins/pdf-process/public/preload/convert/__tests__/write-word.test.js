// globals: true in vitest.preload.config.js — do not require('vitest') (Vitest 4 CJS ban)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const sample = require('../fixtures/sample-schema.json')
const { writeWord } = require('../write-word.js')

describe('writeWord', () => {
  it('writes a valid docx zip', async () => {
    const out = path.join(os.tmpdir(), `convert-word-${Date.now()}.docx`)
    await writeWord(sample, out)
    const buf = fs.readFileSync(out)
    expect(buf[0]).toBe(0x50) // P
    expect(buf[1]).toBe(0x4b) // K  zip
    fs.unlinkSync(out)
  })
})
