const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { assemble, verifyPackage } = require('../../build-config/ztools/package.cjs')
test('standalone package is explicit, readable, complete and detects missing resources/dependencies/licenses', () => {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lx-package-')), 'plugin')
  const result = assemble({ source: path.resolve('src-ztools'), destination: root })
  assert.ok(result.files > 100)
  assert.equal(fs.existsSync(path.join(root, 'node_modules')), false)
  assert.ok(fs.readFileSync(path.join(root, 'preload/runtime/index.cjs'), 'utf8').includes('function initializeRuntime'))
  const candidates = ['LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES.txt', 'dist/lx.html', 'dist/lyric.html', 'dist/pitch_shifter.audioWorklet.js', 'preload/node_modules/node-id3/index.js', 'preload/node_modules/safer-buffer/safer.js']
  for (const file of candidates) {
    const target = path.join(root, file), bytes = fs.readFileSync(target)
    fs.unlinkSync(target)
    assert.throws(() => verifyPackage(root), /缺少|校验|资源|依赖|ENOENT/)
    fs.writeFileSync(target, bytes)
  }
  verifyPackage(root)
})
