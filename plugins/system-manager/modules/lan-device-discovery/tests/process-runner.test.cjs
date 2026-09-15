'use strict'

const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const test = require('node:test')

const { MAX_OUTPUT_BYTES, createProcessRunner } = require('../public/preload/network/process-runner.cjs')

function fakeChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdout.setEncoding = () => {}
  child.stderr.setEncoding = () => {}
  child.killed = false
  child.kill = () => {
    child.killed = true
    queueMicrotask(() => child.emit('close', null, 'SIGTERM'))
    return true
  }
  return child
}

test('process runner always disables shell and abort kills the child', async () => {
  const child = fakeChild()
  let spawnOptions
  const run = createProcessRunner((_file, _args, options) => {
    spawnOptions = options
    return child
  })
  const controller = new AbortController()
  const flight = run('/bin/ping', ['-n', '-c', '1', '192.168.1.1'], { timeoutMs: 1_000, signal: controller.signal })
  controller.abort()
  const result = await flight
  assert.equal(spawnOptions.shell, false)
  assert.equal(child.killed, true)
  assert.equal(result.aborted, true)
})

test('process runner rejects non-array or non-string arguments', async () => {
  const run = createProcessRunner(() => fakeChild())
  await assert.rejects(run('ping', ['192.168.1.1']), /Invalid/)
  await assert.rejects(run('/bin/ping', '192.168.1.1'), /Invalid/)
  await assert.rejects(run('/bin/ping', ['ok', 42]), /Invalid/)
})

function neverClosingChild() {
  const child = fakeChild()
  child.killSignals = []
  child.kill = (signal) => {
    child.killed = true
    child.killSignals.push(signal)
    return true
  }
  child.unref = () => { child.unrefCalled = true }
  return child
}

test('timeout escalates TERM to KILL and finally settles even when child never closes', async () => {
  const child = neverClosingChild()
  const run = createProcessRunner(() => child, { graceMs: 10, settleMs: 25 })
  const result = await run('/bin/ping', ['192.168.1.1'], { timeoutMs: 50 })
  assert.equal(result.timedOut, true)
  assert.deepEqual(child.killSignals, ['SIGTERM', 'SIGKILL'])
  assert.equal(child.unrefCalled, true)
})

test('abort escalates and settles even when child never closes', async () => {
  const child = neverClosingChild()
  const recordKill = child.kill
  child.kill = (signal) => {
    const output = recordKill(signal)
    if (signal === 'SIGTERM') queueMicrotask(() => child.emit('error', new Error('TERM denied')))
    return output
  }
  const run = createProcessRunner(() => child, { graceMs: 10, settleMs: 25 })
  const controller = new AbortController()
  const flight = run('/bin/ping', ['192.168.1.1'], { timeoutMs: 1_000, signal: controller.signal })
  controller.abort()
  const result = await flight
  assert.equal(result.aborted, true)
  assert.deepEqual(child.killSignals, ['SIGTERM', 'SIGKILL'])
})

test('stdout and stderr share one hard output limit with explicit OUTPUT_LIMIT error', async () => {
  const child = neverClosingChild()
  const run = createProcessRunner(() => child, { graceMs: 10, settleMs: 25 })
  const flight = run('/usr/sbin/arp', ['-an'], { timeoutMs: 1_000 })
  child.stdout.emit('data', 'x'.repeat(MAX_OUTPUT_BYTES))
  child.stderr.emit('data', 'y')
  await assert.rejects(flight, (error) => error.code === 'OUTPUT_LIMIT')
  assert.deepEqual(child.killSignals, ['SIGTERM', 'SIGKILL'])
})
