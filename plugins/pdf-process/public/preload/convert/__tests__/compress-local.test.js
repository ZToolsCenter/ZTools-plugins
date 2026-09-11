import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const services = path.resolve(here, '../../services.js')

describe('compressPdf uses the local JavaScript implementation', () => {
  it('does not invoke an external compressor', () => {
    const src = fs.readFileSync(services, 'utf8')
    expect(src).not.toMatch(/PRESSE_PATH/)
    expect(src).not.toMatch(/callPresse/)
    const method = src.match(/async compressPdf[\s\S]*?async mergePdfs/)
    expect(method).toBeTruthy()
    expect(method[0]).toMatch(/pdfOperations\.optimizePdf/)
    expect(method[0]).not.toMatch(/spawn\(/)
  })
})
