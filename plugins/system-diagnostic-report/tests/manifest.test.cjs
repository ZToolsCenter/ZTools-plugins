const assert = require('node:assert/strict')
const { readFileSync, existsSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const pluginRoot = path.resolve(__dirname, '..')
const manifestPath = path.join(pluginRoot, 'public', 'plugin.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

test('manifest defines the fixed plugin identity and entry points', () => {
  assert.equal(manifest.name, 'system-diagnostic-report')
  assert.equal(manifest.title, '系统诊断报告')
  assert.equal(manifest.version, '0.1.1')
  assert.equal(manifest.main, 'index.html')
  assert.equal(manifest.preload, 'preload/services.js')
  assert.equal(manifest.logo, 'logo.svg')
  assert.equal(manifest.development?.main, 'http://127.0.0.1:5173/')
  assert.equal(typeof manifest.description, 'string')
  assert.ok(manifest.description.trim().length > 0)
})

test('manifest exposes one stable feature with the five fixed keywords', () => {
  assert.ok(Array.isArray(manifest.features))
  assert.equal(manifest.features.length, 1)

  const [feature] = manifest.features
  assert.equal(feature.code, 'system-diagnostic-report')
  assert.equal(typeof feature.explain, 'string')
  assert.ok(feature.explain.trim().length > 0)
  assert.equal(feature.icon, manifest.logo)
  assert.deepEqual(feature.cmds, ['系统诊断', '系统信息', '诊断报告', '电脑配置', '硬件信息'])
  assert.equal(new Set(feature.cmds).size, feature.cmds.length)
})

test('manifest explicitly supports all three desktop platforms', () => {
  assert.deepEqual(manifest.features[0].platform, ['darwin', 'win32', 'linux'])
  assert.equal(new Set(manifest.features[0].platform).size, 3)
})

test('manifest file entries are safe relative paths backed by source files', () => {
  const expectedSource = {
    main: path.join(pluginRoot, manifest.main),
    preload: path.join(pluginRoot, 'public', manifest.preload),
    logo: path.join(pluginRoot, 'public', manifest.logo),
  }

  for (const [field, target] of Object.entries(expectedSource)) {
    const value = manifest[field]
    assert.equal(path.isAbsolute(value), false, `${field} must be relative`)
    assert.equal(path.normalize(value).startsWith('..'), false, `${field} must stay inside the plugin`)
    assert.equal(existsSync(target), true, `${field} target must exist: ${target}`)
  }
})

test('manifest version matches package.json', () => {
  const packageJson = JSON.parse(readFileSync(path.join(pluginRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.version, packageJson.version)
})

test('preload exposes only the minimum report bridge', () => {
  const services = readFileSync(path.join(pluginRoot, 'public', 'preload', 'services.js'), 'utf8')
  const bridge = services.match(/window\.systemReport\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/)
  assert.ok(bridge, 'systemReport bridge must be declared')
  const methods = bridge[1]
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  assert.deepEqual(methods, ['collect', 'copyText', 'saveReport', 'startDrag'])
})
