'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { createHermesRuntimeManager, normalizeWebPath, resolvePort } = require('../preload/hermesRuntimeManager')

function requestWithStatus(statusCode) {
  return (url, options, callback) => {
    const req = new EventEmitter()
    req.setTimeout = () => req
    req.destroy = (error) => req.emit('error', error)
    req.end = () => process.nextTick(() => statusCode ? callback({ statusCode, resume() {} }) : req.emit('error', new Error('offline')))
    req.url = url; req.options = options
    return req
  }
}

test('probes only the loopback Hermes status endpoint and accepts 200 or 401', async () => {
  for (const statusCode of [200, 401]) {
    const manager = createHermesRuntimeManager({ port: 9123, request: requestWithStatus(statusCode) })
    const status = await manager.probeWebUi()
    assert.equal(status.online, true)
    assert.equal(status.statusCode, statusCode)
    assert.equal(status.baseUrl, 'http://127.0.0.1:9123')
  }
  assert.equal((await createHermesRuntimeManager({ request: requestWithStatus(404) }).probeWebUi()).online, false)
  assert.equal((await createHermesRuntimeManager({ request: requestWithStatus(0) }).probeWebUi()).error, 'hermes_web_offline')
})

test('opens a validated local Hermes path through the host shell', async () => {
  const opened = []
  const manager = createHermesRuntimeManager({ port: 9444, request: requestWithStatus(401), openExternal: async (url) => opened.push(url) })
  const result = await manager.openWebUi('/config?tab=models')
  assert.equal(result.target, 'http://127.0.0.1:9444/config?tab=models')
  assert.deepEqual(opened, [result.target])
  await assert.rejects(() => manager.openWebUi('https://evil.example/'), /路径无效/)
  await assert.rejects(() => createHermesRuntimeManager({ request: requestWithStatus(0) }).openWebUi('/config'), /hermes_web_offline/)
  assert.equal(normalizeWebPath('config'), '/config')
  assert.equal(resolvePort('70000'), 9119)
})

test('launches only the fixed Hermes dashboard command on each platform', async () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    const calls = []
    const result = await createHermesRuntimeManager({ platform, execFile: async (...args) => calls.push(args) }).launchDashboard()
    assert.equal(result.command, 'hermes dashboard')
    assert.equal(calls.length, 1)
    assert.match(JSON.stringify(calls[0]), /hermes dashboard/)
    assert.doesNotMatch(JSON.stringify(calls[0]), /undefined|null/)
  }
})
