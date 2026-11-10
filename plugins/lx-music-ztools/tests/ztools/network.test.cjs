const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { createNetwork } = require('../../src-ztools/preload/runtime/network.cjs')

test('LX transport preserves JSON/form/headers and cancels pending requests', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/wait') return
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ method: req.method, body, tag: req.headers['x-tag'] })) })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const network = createNetwork()
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const [a, b] = await Promise.all([
      network.request({ url: base, headers: { 'x-tag': 'a' } }).result,
      network.request({ url: base, method: 'post', form: { message: 'hello world' }, headers: { 'x-tag': 'b' } }).result,
    ])
    assert.equal(a.body.tag, 'a'); assert.equal(b.body.tag, 'b')
    assert.equal(b.body.method, 'POST'); assert.equal(b.body.body, 'message=hello%20world')
    const pending = network.request({ url: base + '/wait' })
    pending.cancel()
    await assert.rejects(pending.result, /取消|cancel/i)
    await assert.rejects(network.request({ url: 'file:///C:/Windows/win.ini' }).result, /HTTP/)
  } finally { network.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})
