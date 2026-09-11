import test from 'node:test'
import assert from 'node:assert/strict'
import { supportsMultiSelectClipboard } from '../src/utils/appVersion.js'

test('accepts supported stable versions', () => {
  assert.equal(supportsMultiSelectClipboard('3.0.2'), true)
  assert.equal(supportsMultiSelectClipboard('3.0.3'), true)
  assert.equal(supportsMultiSelectClipboard('4.0.0'), true)
  assert.equal(supportsMultiSelectClipboard('v3.0.2'), true)
})

test('accepts the 3.0.2 beta and release candidate lines', () => {
  assert.equal(supportsMultiSelectClipboard('3.0.2-beta.1'), true)
  assert.equal(supportsMultiSelectClipboard('3.0.2-beta.24'), true)
  assert.equal(supportsMultiSelectClipboard('3.0.2-rc.1'), true)
})

test('rejects versions before the supported beta line', () => {
  assert.equal(supportsMultiSelectClipboard('3.0.1'), false)
  assert.equal(supportsMultiSelectClipboard('3.0.2-alpha.9'), false)
  assert.equal(supportsMultiSelectClipboard('2.9.9'), false)
  assert.equal(supportsMultiSelectClipboard(''), false)
  assert.equal(supportsMultiSelectClipboard(undefined), false)
})
