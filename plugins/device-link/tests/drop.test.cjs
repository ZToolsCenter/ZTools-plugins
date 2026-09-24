'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { resolveDroppedFilePaths } = require('../public/preload/core/drop')

test('dropped files prefer Electron webUtils paths and remove duplicates', () => {
  const first = path.resolve('/tmp/device-link-first.txt')
  const second = path.resolve('/tmp/device-link-second.txt')
  const files = [{ nativePath: first }, { nativePath: second }, { nativePath: first }]

  assert.deepEqual(resolveDroppedFilePaths(files, (file) => file.nativePath), [first, second])
})

test('dropped files fall back to legacy File.path', () => {
  const legacyPath = path.resolve('/tmp/device-link-legacy.txt')
  assert.deepEqual(resolveDroppedFilePaths([{ path: legacyPath }], () => { throw new Error('unsupported') }), [legacyPath])
})

test('dropped files reject browser-only files without local paths', () => {
  assert.throws(() => resolveDroppedFilePaths([{ name: 'browser.txt' }]), /无法读取拖入文件/)
})
