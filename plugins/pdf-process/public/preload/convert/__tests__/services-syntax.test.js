import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = path.dirname(fileURLToPath(import.meta.url))
const services = path.resolve(here, '../../services.js')

describe('services.js syntax', () => {
  it('parses as valid JavaScript (no BOM / broken strings)', () => {
    const buf = fs.readFileSync(services)
    expect(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf).toBe(false)
    const src = buf.toString('utf8')
    expect(() => new vm.Script(src, { filename: 'services.js' })).not.toThrow()
    expect(src).toMatch(/pdfOperations/)
    expect(src).not.toMatch(/node:child_process/)
  })
})
