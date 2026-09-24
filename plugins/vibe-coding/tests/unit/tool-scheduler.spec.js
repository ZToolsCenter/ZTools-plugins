import assert from 'node:assert/strict'
import test from 'node:test'
import { executeScheduledToolCalls, normalizeToolConcurrencyLimit } from '../../src/services/tool-scheduler.js'

test('工具调度器限制并行调用数量且结果保持模型顺序', async () => {
  const calls = [1, 2, 3, 4].map((id) => ({ id: String(id), name: 'read', status: 'queued' }))
  const started = []
  const releases = new Map()
  let active = 0
  let peak = 0
  const result = executeScheduledToolCalls(calls, {
    maxParallel: 2,
    getMode: () => 'parallel',
    execute: async (call) => {
      started.push(call.id)
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => releases.set(call.id, () => { active -= 1; resolve() }))
      return `done-${call.id}`
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.deepEqual(started, ['1', '2'])
  releases.get('2')()
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.deepEqual(started, ['1', '2', '3'])
  releases.get('1')()
  releases.get('3')()
  await new Promise((resolve) => setTimeout(resolve, 5))
  releases.get('4')()
  const settled = await result
  assert.deepEqual(settled.results, ['done-1', 'done-2', 'done-3', 'done-4'])
  assert.equal(settled.started, 4)
  assert.equal(settled.skipped, 0)
  assert.equal(peak <= 2, true)
})

test('独占工具在并行组结束后执行，后续并行组继续复用并发池', async () => {
  const calls = [
    { id: 'read-1', name: 'read', status: 'queued' },
    { id: 'read-2', name: 'read', status: 'queued' },
    { id: 'write', name: 'write', status: 'queued' },
    { id: 'read-3', name: 'read', status: 'queued' },
  ]
  const events = []
  const result = await executeScheduledToolCalls(calls, {
    maxParallel: 2,
    getMode: (name) => name === 'read' ? 'parallel' : 'exclusive',
    execute: async (call) => {
      events.push(`start:${call.id}`)
      await Promise.resolve()
      events.push(`done:${call.id}`)
      return call.id
    },
  })
  assert.deepEqual(result.results, ['read-1', 'read-2', 'write', 'read-3'])
  assert.ok(events.indexOf('done:read-2') < events.indexOf('start:write'))
  assert.ok(events.indexOf('done:write') < events.indexOf('start:read-3'))
})

test('停止后不启动并行池中尚未开始的工具', async () => {
  const calls = [1, 2, 3].map((id) => ({ id: String(id), name: 'read', status: 'queued' }))
  const started = []
  let stopped = false
  const releases = []
  const pending = executeScheduledToolCalls(calls, {
    maxParallel: 1,
    getMode: () => 'parallel',
    isCancelled: () => stopped,
    execute: async (call) => {
      started.push(call.id)
      await new Promise((resolve) => releases.push(resolve))
      return `done-${call.id}`
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.deepEqual(started, ['1'])
  stopped = true
  releases[0]()
  const settled = await pending
  assert.deepEqual(started, ['1'])
  assert.deepEqual(settled.results, ['done-1', '用户已终止本轮对话，工具未执行。', '用户已终止本轮对话，工具未执行。'])
  assert.equal(settled.started, 1)
  assert.equal(settled.skipped, 2)
})

test('工具并发上限规范化为 1 到 50 的整数', () => {
  assert.equal(normalizeToolConcurrencyLimit(undefined), 10)
  assert.equal(normalizeToolConcurrencyLimit(0), 1)
  assert.equal(normalizeToolConcurrencyLimit(3.6), 4)
  assert.equal(normalizeToolConcurrencyLimit(99), 50)
})
