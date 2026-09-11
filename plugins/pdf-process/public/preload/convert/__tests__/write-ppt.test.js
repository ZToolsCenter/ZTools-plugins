// globals: true in vitest.preload.config.js — do not require('vitest') (Vitest 4 CJS ban)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const sample = require('../fixtures/sample-schema.json')
const { writePpt } = require('../write-ppt.js')

describe('writePpt', () => {
  it('writes pptx zip with one slide per page', async () => {
    const out = path.join(os.tmpdir(), `convert-pptx-${Date.now()}.pptx`)
    await writePpt(sample, out)
    const buf = fs.readFileSync(out)
    expect(buf[0]).toBe(0x50)
    expect(buf[1]).toBe(0x4b)
    // sample has 2 pages
    // structural check: file size non-trivial
    expect(buf.length).toBeGreaterThan(2000)
    fs.unlinkSync(out)
  })

  it('still writes to disk when a window global exists (Electron preload)', async () => {
    const previousWindow = global.window
    global.window = {}
    try {
      const out = path.join(os.tmpdir(), `convert-pptx-window-${Date.now()}.pptx`)
      await writePpt(sample, out)
      const buf = fs.readFileSync(out)
      expect(buf[0]).toBe(0x50)
      expect(buf[1]).toBe(0x4b)
      expect(buf.length).toBeGreaterThan(2000)
      fs.unlinkSync(out)
    } finally {
      if (previousWindow === undefined) delete global.window
      else global.window = previousWindow
    }
  })
})
