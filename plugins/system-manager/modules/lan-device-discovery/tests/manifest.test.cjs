'use strict'

const assert = require('node:assert/strict')
const { existsSync, readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const manifest = JSON.parse(readFileSync(path.join(root, 'public', 'plugin.json'), 'utf8'))

test('manifest has stable identity, safe local entries, and all desktop platforms', () => {
  assert.equal(manifest.name, 'lan-device-discovery')
  assert.equal(manifest.title, '局域网设备发现')
  assert.equal(manifest.version, '0.1.0')
  assert.equal(manifest.main, 'index.html')
  assert.equal(manifest.preload, 'preload/services.js')
  assert.equal(manifest.logo, 'logo.svg')
  assert.deepEqual(manifest.features[0].platform, ['darwin', 'win32', 'linux'])
  assert.equal(manifest.features[0].code, 'lan-device-discovery')
  assert.equal(new Set(manifest.features[0].cmds).size, manifest.features[0].cmds.length)
  for (const entry of [manifest.main, manifest.preload, manifest.logo]) {
    assert.equal(path.isAbsolute(entry), false)
    assert.equal(path.normalize(entry).startsWith('..'), false)
  }
  assert.ok(existsSync(path.join(root, manifest.main)))
  assert.ok(existsSync(path.join(root, 'public', manifest.preload)))
  assert.ok(existsSync(path.join(root, 'public', manifest.logo)))
})

test('manifest and package versions match', () => {
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(manifest.version, packageJson.version)
})

test('preload bridge exposes only four narrow business methods', () => {
  const source = readFileSync(path.join(root, 'public', 'preload', 'services.js'), 'utf8')
  const bridge = source.match(/window\.lanDiscovery\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/)
  assert.ok(bridge)
  const properties = [...bridge[1].matchAll(/^\s*([A-Za-z]+)(?::|,)/gm)].map((match) => match[1])
  assert.deepEqual(properties, ['listInterfaces', 'scan', 'cancelScan', 'copyText'])
})
