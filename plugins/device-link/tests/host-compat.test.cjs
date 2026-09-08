'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { detectHostCompatibility, resolveDataDirectories } = require('../public/preload/core/host-compat')

test('real hosts fail closed when their version cannot be trusted', () => {
  assert.deepEqual(detectHostCompatibility(undefined), {
    mode: 'browser-preview',
    requiresUpgrade: false,
    reason: 'browser-preview',
  })
  assert.equal(detectHostCompatibility({}).requiresUpgrade, true)
  assert.equal(detectHostCompatibility({ getAppVersion() { throw new Error('bridge failure') } }).requiresUpgrade, true)
  assert.equal(detectHostCompatibility({ getAppVersion() { return 'not-a-version' } }).requiresUpgrade, true)
  assert.equal(detectHostCompatibility({ getAppVersion() { return '2.3.9' } }).requiresUpgrade, true)
  assert.equal(detectHostCompatibility({ getAppVersion() { return '2.4.0-beta.1' } }).requiresUpgrade, true)
  assert.deepEqual(detectHostCompatibility({ getAppVersion() { return '3.2.0' } }), {
    mode: 'supported',
    version: '3.2.0',
    requiresUpgrade: false,
    reason: 'supported',
  })
})

test('pluginData is preferred while the legacy userData directory remains addressable', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-host-compat-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const paths = resolveDataDirectories({
    getPath(name) {
      if (name === 'userData') return path.join(root, 'userData')
      if (name === 'pluginData') return path.join(root, 'pluginData')
      return ''
    },
  })
  assert.equal(paths.dataDir, path.join(root, 'pluginData'))
  assert.equal(paths.legacyDataDir, path.join(root, 'userData', 'device-link'))
  assert.equal(paths.usingPluginData, true)
})

test('legacy userData remains the write location when pluginData is unavailable', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-host-fallback-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const paths = resolveDataDirectories({
    getPath(name) {
      if (name === 'userData') return path.join(root, 'userData')
      return ''
    },
  })
  assert.equal(paths.dataDir, path.join(root, 'userData', 'device-link'))
  assert.equal(paths.legacyDataDir, paths.dataDir)
  assert.equal(paths.usingPluginData, false)
})
