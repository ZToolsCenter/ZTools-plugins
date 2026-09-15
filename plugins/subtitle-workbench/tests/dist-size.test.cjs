'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

test('dist size gate recursively counts exact bytes against the decimal 14.5 MB limit', async () => {
  const { assertDistSize, MAX_DIST_BYTES, measureDirectoryBytes } = await import('../scripts/dist-size.mjs')
  assert.equal(MAX_DIST_BYTES, 14_500_000)
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-dist-size-'))
  try {
    await fs.mkdir(path.join(directory, 'nested'))
    await fs.writeFile(path.join(directory, 'root.bin'), Buffer.alloc(7))
    await fs.writeFile(path.join(directory, 'nested', 'child.bin'), Buffer.alloc(11))
    assert.equal(await measureDirectoryBytes(directory), 18)
    assert.equal(assertDistSize(MAX_DIST_BYTES), MAX_DIST_BYTES)
    assert.throws(() => assertDistSize(MAX_DIST_BYTES + 1), /14500001 bytes.*14500000-byte limit/)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
