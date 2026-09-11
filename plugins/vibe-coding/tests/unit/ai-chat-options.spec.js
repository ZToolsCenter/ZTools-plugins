import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { normalizeOptionalTemperature } = require('../../public/ai-chat-options.js')

test('未配置温度时不向宿主注入默认值', () => {
  assert.equal(normalizeOptionalTemperature(undefined), undefined)
  assert.equal(normalizeOptionalTemperature(null), undefined)
  assert.equal(normalizeOptionalTemperature(''), undefined)
  assert.equal(normalizeOptionalTemperature('invalid'), undefined)
})

test('显式有效温度保持为数值传给宿主', () => {
  assert.equal(normalizeOptionalTemperature(0), 0)
  assert.equal(normalizeOptionalTemperature('0.2'), 0.2)
})
