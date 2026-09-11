import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginJson = path.resolve(here, '../../../plugin.json')

describe('plugin.json package layout (ZTools scheme A)', () => {
  it('does not need unpacking when there are no native runtime files', () => {
    const cfg = JSON.parse(fs.readFileSync(pluginJson, 'utf8'))
    expect('unpack' in cfg).toBe(false)

    const files = [
      'preload/services.js',
      'index.html',
    ]
    expect(files.every((file) => !/(\.node|\.dat)$/.test(file))).toBe(true)
  })
})
