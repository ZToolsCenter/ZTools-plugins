import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyStreamingToolCallDelta,
  normalizeToolCalls,
} from '../../src/services/tool-call-stream.js'

test('宿主非零工具索引只用于关联分片，不会制造稀疏展示数组', () => {
  const calls = []
  const slots = new Map()
  const helpers = {
    makeId: () => 'generated-call',
    parseArguments: (value) => ({ raw: value }),
  }

  applyStreamingToolCallDelta(calls, slots, {
    index: 2,
    id: 'call-a',
    name: 'lookup',
    argumentsDelta: '{"id"',
  }, helpers)
  applyStreamingToolCallDelta(calls, slots, {
    index: 2,
    argumentsDelta: ':2}',
  }, helpers)
  applyStreamingToolCallDelta(calls, slots, {
    index: 5,
    id: 'call-b',
    name: 'read',
    argumentsDelta: '{}',
  }, helpers)

  assert.equal(calls.length, 2)
  assert.equal(0 in calls, true)
  assert.equal(1 in calls, true)
  assert.equal(calls[0].id, 'call-a')
  assert.equal(calls[0].arguments, '{"id":2}')
  assert.equal(calls[1].id, 'call-b')
})

test('历史工具列表会过滤 JSON 空值和稀疏空位', () => {
  const sparse = []
  sparse[1] = { id: 'call-a' }
  sparse[3] = null
  const holesOnly = []
  holesOnly[2] = { id: 'call-b' }

  assert.deepEqual(normalizeToolCalls(sparse), [{ id: 'call-a' }])
  assert.deepEqual(normalizeToolCalls(holesOnly), [{ id: 'call-b' }])
})
