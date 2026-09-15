'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const plugin = JSON.parse(readFileSync(path.join(root, 'public', 'plugin.json'), 'utf8'))

test('manifest exposes one safe cross-platform feature', () => {
  assert.equal(plugin.name, 'system-cleaner')
  assert.equal(plugin.main, 'index.html')
  assert.equal(plugin.preload, 'preload/services.js')
  assert.deepEqual(plugin.features[0].platform, ['darwin', 'win32', 'linux'])
  assert.equal(new Set(plugin.features[0].cmds).size, 4)
  assert.doesNotMatch(plugin.description, /清理.*废纸篓内容/)
})

test('preload bridge is narrow and does not expose arbitrary paths or commands', () => {
  const source = readFileSync(path.join(root, 'public', 'preload', 'services.js'), 'utf8')
  const bridge = source.match(/window\.systemCleaner\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/)
  assert.ok(bridge)
  const methods = bridge[1].split(',').map((item) => item.trim()).filter(Boolean)
  assert.deepEqual(methods, ['scan: cleaner.scan', 'cancelScan: cleaner.cancelScan', 'clean: cleaner.clean', 'reveal', 'copyText'])
  assert.doesNotMatch(source, /exec\(|execSync|spawn\(|rmSync|unlinkSync/)
})

test('browser UI documents preview and typed confirmation', () => {
  const html = readFileSync(path.join(root, 'public', 'index.html'), 'utf8')
  const app = readFileSync(path.join(root, 'public', 'app.js'), 'utf8')
  assert.match(html, /清理预览/)
  assert.match(html, /移到废纸篓/)
  assert.match(html, /Content-Security-Policy/)
  assert.doesNotMatch(html, /value="trash"/)
  assert.doesNotMatch(app, /demoApi|demo-snapshot|freedBytes/)
  assert.match(app, /本地清理能力未加载/)
})
