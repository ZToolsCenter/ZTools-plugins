const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-services-'))
global.window = {
  ztools: {
    getPath: (name) => (name === 'downloads' ? downloads : path.join(downloads, name)),
  },
  services: {},
}

require('../../services.js')
const services = window.services

describe('services.writeFileBase64', () => {
  afterAll(() => {
    fs.rmSync(downloads, { recursive: true, force: true })
  })

  it('writes bytes into a pdf-* task file', () => {
    const out = path.join(downloads, 'pdf-tmp', 'shared.pdf')
    const saved = services.writeFileBase64(Buffer.from('pdf bytes').toString('base64'), out)
    expect(saved).toBe(out)
    expect(fs.readFileSync(saved, 'utf8')).toBe('pdf bytes')
  })

  it('rejects empty payloads and unsafe output paths', () => {
    const out = path.join(downloads, 'pdf-tmp', 'empty.pdf')
    expect(() => services.writeFileBase64('', out)).toThrow(/无效/)
    expect(() =>
      services.writeFileBase64(Buffer.from('x').toString('base64'), path.join(os.tmpdir(), 'outside.pdf')),
    ).toThrow(/下载目录/)
  })
})
