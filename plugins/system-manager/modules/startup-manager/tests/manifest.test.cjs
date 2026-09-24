'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/plugin.json'), 'utf8'))

test('manifest declares stable identity, bridge, and all desktop platforms', () => {
  assert.equal(manifest.name, 'startup-manager')
  assert.equal(manifest.version, '0.1.0')
  assert.equal(manifest.main, 'index.html')
  assert.equal(manifest.preload, 'preload/services.js')
  assert.deepEqual(manifest.features[0].platform, ['darwin', 'win32', 'linux'])
  assert.equal(new Set(manifest.features[0].cmds).size, manifest.features[0].cmds.length)
})

test('manifest entries stay within plugin and point to source files', () => {
  const roots = { main: root, preload: path.join(root, 'public'), logo: path.join(root, 'public') }
  for (const field of ['main', 'preload', 'logo']) {
    assert.equal(path.isAbsolute(manifest[field]), false)
    assert.equal(path.normalize(manifest[field]).startsWith('..'), false)
    assert.equal(fs.existsSync(path.join(roots[field], manifest[field])), true)
  }
})

test('preload exposes scan, setEnabled, undo, and lifecycle shutdown', () => {
  const source = fs.readFileSync(path.join(root, 'public/preload/services.js'), 'utf8')
  const bridge = source.match(/window\.startupManager\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/)
  assert.ok(bridge)
  assert.deepEqual([...bridge[1].matchAll(/^\s*(\w+):/gm)].map((match) => match[1]), ['scan', 'setEnabled', 'undo', 'shutdown'])
  assert.doesNotMatch(source, /window\.startupManager.*(?:exec|runFile|readFile|writeFile)/s)
  assert.doesNotMatch(source, /\b(?:window\.)?ztools\.onPluginOut\s*\(/)
})
