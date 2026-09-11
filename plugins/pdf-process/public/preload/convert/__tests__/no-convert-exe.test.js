// Vitest 4: use globals (see vitest.preload.config.js); do not require('vitest')
const fs = require('node:fs')
const path = require('node:path')

describe('no convert.exe pipeline', () => {
  it('services.js does not spawn convert.exe and uses local convert only', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../services.js'), 'utf8')
    expect(src).not.toMatch(/callConvert\s*\(/)
    expect(src).not.toMatch(/CONVERT_PATH/)
    expect(src).not.toMatch(/convert\.exe/)
    expect(src).not.toMatch(/convertPdfWithAi/)
    expect(src).toMatch(/convertPdfLocal/)
    expect(src).toMatch(/require\('\.\/convert\/convert-local'\)/)
  })

  it('convert.exe is not shipped under public/bin', () => {
    const bin = path.join(__dirname, '../../../bin/convert.exe')
    expect(fs.existsSync(bin)).toBe(false)
  })
})
