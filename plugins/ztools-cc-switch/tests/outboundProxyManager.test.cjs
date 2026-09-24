'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const nodeFetch = require('../preload/node_modules/node-fetch')
const { createMemoryStorage } = require('../preload/webdavSyncManager')
const { normalizeProxyUrl, maskProxyUrl, createOutboundProxyManager } = require('../preload/outboundProxyManager')

test('validates proxy URLs and prevents local-router recursion', () => {
  assert.equal(normalizeProxyUrl('http://127.0.0.1:7890'), 'http://127.0.0.1:7890')
  assert.equal(maskProxyUrl('socks5://user:secret@localhost:1080'), 'socks5://localhost:1080')
  assert.throws(() => normalizeProxyUrl('ftp://localhost:21'), /仅支持/)
  assert.throws(() => normalizeProxyUrl('http://127.0.0.1:15721'), /自身/)
  assert.throws(() => normalizeProxyUrl('http://localhost:7890/path'), /不能包含路径/)
})

test('stores proxy password outside readable config and uses a proxy-aware fetch', async () => {
  const storage = createMemoryStorage()
  const calls = []
  const manager = createOutboundProxyManager({
    storage,
    secretCodec: { secure: true, encode: (value) => `enc:${value}`, decode: (value) => value.slice(4) },
    nodeFetch: async (url, init) => { calls.push({ url, init }); return new nodeFetch.Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }) }
  })
  const saved = manager.saveConfig({ url: 'http://proxy.example:8080', username: 'demo', password: 'secret', enabled: true })
  assert.equal(saved.hasPassword, true)
  assert.equal(JSON.stringify(saved).includes('secret'), false)
  const response = await manager.fetch('https://api.example.test/v1')
  assert.equal(await response.text(), 'ok')
  assert.equal(calls.length, 1)
  assert.ok(calls[0].init.agent)
  const tested = await manager.testProxy({})
  assert.equal(tested.success, true)
})

test('scans the upstream common proxy port list without real sockets', async () => {
  const storage = createMemoryStorage()
  const connector = (port) => {
    const socket = new EventEmitter()
    socket.destroy = () => {}; socket.setTimeout = () => {}
    process.nextTick(() => socket.emit(port === 7890 || port === 1080 ? 'connect' : 'error', new Error('closed')))
    return socket
  }
  const manager = createOutboundProxyManager({ storage, secretCodec: { secure: false, encode: String, decode: String }, connector })
  const found = await manager.scanLocalProxies()
  assert.deepEqual(found.map((item) => item.url), [
    'http://127.0.0.1:7890', 'socks5://127.0.0.1:7890', 'socks5://127.0.0.1:1080'
  ])
})
