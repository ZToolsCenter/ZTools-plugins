import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

test('the preload reads supported JSON files and rejects invalid paths or excess size', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'json-editor-preload-'))
  globalThis.window = {}
  try {
    await import('../../src-ztools/preload/services.js')
    const { readFileContent } = window.services
    const accepted = join(directory, 'example.JSON')
    const invalid = join(directory, 'example.txt')
    const tooLarge = join(directory, 'large.json')
    writeFileSync(accepted, '{"file":"测试"}')
    writeFileSync(invalid, '{}')
    writeFileSync(tooLarge, '')
    truncateSync(tooLarge, 32 * 1024 * 1024 + 1)

    assert.equal(readFileContent(accepted), '{"file":"测试"}')
    assert.equal(readFileContent(invalid), '')
    assert.equal(readFileContent(tooLarge), '')
    assert.equal(readFileContent(join(directory, 'missing.json')), '')
    assert.equal(readFileContent('relative.json'), '')
    assert.equal(readFileContent(null), '')
  } finally {
    delete globalThis.window
    rmSync(directory, { recursive: true, force: true })
  }
})
